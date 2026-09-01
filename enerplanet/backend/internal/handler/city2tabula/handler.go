// Package city2tabula is the HTTP handler for the on-request 3D-data enrich
// endpoint. Given a user-drawn area (country plus its PyLovo osm_ids and the
// bbox), it resolves City2TABULA envelope data for those buildings and returns
// a per-osm_id merge map the Building Configurator folds onto its building
// features.
//
// A bbox-scoped City2TABULA pipeline run can take minutes, so the endpoint
// never blocks on one: it returns what is already linked immediately and, when
// a run is needed, triggers it and hands back the run id for the client to
// poll.
package city2tabula

import (
	"context"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"platform.local/common/pkg/httputil"
	"platform.local/platform/logger"

	c2t "spatialhub_backend/internal/city2tabula"
)

// Handler serves the enrich endpoints, backed by the City2TABULA client.
type Handler struct {
	client *c2t.Client
}

// NewHandler returns a Handler bound to the given City2TABULA client.
func NewHandler(client *c2t.Client) *Handler {
	return &Handler{client: client}
}

// enrichRequest is the POST /api/v1/city2tabula/enrich body. bbox is the drawn
// area, used only to trigger a pipeline run when some buildings are unresolved.
type enrichRequest struct {
	Country string    `json:"country"`
	Bbox    bboxInput `json:"bbox"`
	OSMIDs  []string  `json:"osm_ids"`
}

type bboxInput struct {
	Xmin float64 `json:"xmin"`
	Ymin float64 `json:"ymin"`
	Xmax float64 `json:"xmax"`
	Ymax float64 `json:"ymax"`
}

// enrichedBuilding is one entry in the merge map. buem is a building node
// (envelope elements plus the scalar attributes City2TABULA provides) that the
// configurator merges onto its feature's properties.buem by osm_id.
type enrichedBuilding struct {
	ObjectID          string                 `json:"object_id"`
	MatchType         int16                  `json:"match_type"`
	TabulaVariantCode *string                `json:"tabula_variant_code,omitempty"`
	Buem              map[string]interface{} `json:"buem"`
}

// enrichResponse is returned by both endpoints. status is:
//   - completed: every requested osm_id resolved
//   - running:   a pipeline run is in progress; poll the run endpoint
//   - partial:   some resolved, a run was needed but could not be triggered;
//     the client proceeds with what it has
//
// plus, on the run endpoint, City2TABULA's own pending / no_data / failed.
type enrichResponse struct {
	Status   string                      `json:"status"`
	RunID    string                      `json:"run_id,omitempty"`
	Resolved int                         `json:"resolved"`
	Total    int                         `json:"total"`
	Missing  []string                    `json:"missing,omitempty"`
	Data     map[string]enrichedBuilding `json:"data"`
}

// Enrich handles POST /api/v1/city2tabula/enrich.
func (h *Handler) Enrich(c *gin.Context) {
	var req enrichRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, "invalid request payload")
		return
	}
	if req.Country == "" || len(req.OSMIDs) == 0 {
		httputil.BadRequest(c, "country and osm_ids are required")
		return
	}

	ctx := c.Request.Context()
	log := logger.ForComponent("handler:city2tabula_enrich")

	byOSMID, err := h.fetchLinked(ctx, req.Country, req.OSMIDs)
	if err != nil {
		log.Warnf("city2tabula building fetch failed: %v", err)
		httputil.BadGateway(c, "city2tabula unavailable")
		return
	}

	missing := missingOSMIDs(req.OSMIDs, byOSMID)
	resp := enrichResponse{
		Resolved: len(byOSMID),
		Total:    len(req.OSMIDs),
		Missing:  missing,
		Data:     mapBuildings(byOSMID),
	}

	if len(missing) == 0 {
		resp.Status = "completed"
		c.JSON(http.StatusOK, resp)
		return
	}

	run, err := h.client.TriggerRun(ctx, req.Country, c2t.Bbox{
		Xmin: req.Bbox.Xmin, Ymin: req.Bbox.Ymin, Xmax: req.Bbox.Xmax, Ymax: req.Bbox.Ymax,
	})
	if err != nil {
		log.Warnf("city2tabula run trigger failed, returning %d/%d resolved: %v",
			len(byOSMID), len(req.OSMIDs), err)
		resp.Status = "partial"
		c.JSON(http.StatusOK, resp)
		return
	}

	resp.Status = "running"
	resp.RunID = run.RunID
	c.JSON(http.StatusAccepted, resp)
}

// EnrichStatus handles GET /api/v1/city2tabula/enrich/:run_id. It proxies the
// City2TABULA run status. When the run has completed and the request repeats
// country and osm_ids as query parameters, it also returns the merge map for
// those buildings, so the client polls one endpoint and gets data when ready.
func (h *Handler) EnrichStatus(c *gin.Context) {
	runID := c.Param("run_id")
	if runID == "" {
		httputil.BadRequest(c, "run_id is required")
		return
	}

	ctx := c.Request.Context()
	log := logger.ForComponent("handler:city2tabula_enrich")

	run, err := h.client.GetRunStatus(ctx, runID)
	if err != nil {
		log.Warnf("city2tabula run status failed for %s: %v", runID, err)
		httputil.BadGateway(c, "city2tabula unavailable")
		return
	}

	resp := enrichResponse{
		Status: run.Status,
		RunID:  run.RunID,
		Data:   map[string]enrichedBuilding{},
	}

	country := c.Query("country")
	osmIDs := splitCSV(c.Query("osm_ids"))
	if run.Status == "completed" && country != "" && len(osmIDs) > 0 {
		byOSMID, ferr := h.fetchLinked(ctx, country, osmIDs)
		if ferr != nil {
			log.Warnf("city2tabula building re-fetch after run %s failed: %v", runID, ferr)
			httputil.BadGateway(c, "city2tabula unavailable")
			return
		}
		resp.Resolved = len(byOSMID)
		resp.Total = len(osmIDs)
		resp.Missing = missingOSMIDs(osmIDs, byOSMID)
		resp.Data = mapBuildings(byOSMID)
	}

	c.JSON(http.StatusOK, resp)
}

// fetchLinked fetches the osm_ids' 3D attributes and indexes them by osm_id. An
// osm_id absent from the result has no PyLovo-linked building in City2TABULA
// yet (see missingOSMIDs).
func (h *Handler) fetchLinked(ctx context.Context, country string, osmIDs []string) (map[string]c2t.Building, error) {
	buildings, err := h.client.GetBuildingsByOSMIDs(ctx, country, osmIDs)
	if err != nil {
		return nil, err
	}
	byOSMID := make(map[string]c2t.Building, len(buildings))
	for _, b := range buildings {
		if b.OSMID != "" {
			byOSMID[b.OSMID] = b
		}
	}
	return byOSMID, nil
}

// missingOSMIDs returns the osm_ids in want that have no entry in got.
func missingOSMIDs(want []string, got map[string]c2t.Building) []string {
	var missing []string
	for _, id := range want {
		if _, ok := got[id]; !ok {
			missing = append(missing, id)
		}
	}
	return missing
}

func splitCSV(s string) []string {
	var out []string
	for _, p := range strings.Split(s, ",") {
		if p = strings.TrimSpace(p); p != "" {
			out = append(out, p)
		}
	}
	return out
}

// mapBuildings turns City2TABULA buildings into merge-map entries. Unlike the
// run_buem job it keeps a building even when no surface qualifies for the
// envelope: the configurator still shows its scalar attributes and TABULA
// variant and falls back to an archetype for the geometry (scenario SC-03).
func mapBuildings(byOSMID map[string]c2t.Building) map[string]enrichedBuilding {
	out := make(map[string]enrichedBuilding, len(byOSMID))
	for osmID, b := range byOSMID {
		building := map[string]interface{}{
			"envelope": map[string]interface{}{
				"elements": c2t.EnvelopeElements(b),
			},
		}
		if b.NumberOfStoreys != nil {
			building["n_storeys"] = *b.NumberOfStoreys
		}
		if b.RoomHeight != nil {
			building["h_room"] = quantity(*b.RoomHeight, "m")
		}
		if b.FootprintAreaSqm != nil {
			building["footprint_area"] = quantity(*b.FootprintAreaSqm, "m2")
		}
		out[osmID] = enrichedBuilding{
			ObjectID:          b.ObjectID,
			MatchType:         b.MatchType,
			TabulaVariantCode: b.TabulaVariantCode,
			Buem:              map[string]interface{}{"building": building},
		}
	}
	return out
}

func quantity(v float64, unit string) map[string]interface{} {
	return map[string]interface{}{"value": v, "unit": unit}
}
