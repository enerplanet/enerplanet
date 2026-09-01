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
	"errors"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"platform.local/common/pkg/httputil"
	"platform.local/platform/logger"

	"spatialhub_backend/internal/api/contracts"
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

// Enrich godoc
//
//	@Summary		Resolve City2TABULA 3D data for a drawn area
//	@Description	Given a drawn area (country, its PyLovo osm_ids, and the bbox) returns a per-osm_id
//	@Description	merge map of BuEM envelope data. Returns 200 "completed" when every osm_id is already
//	@Description	linked, or 202 "running" with a run_id when a bbox-scoped pipeline run was triggered
//	@Description	(the buildings resolved so far are returned alongside). Poll GET .../enrich/{run_id}.
//	@Tags			City2TABULA
//	@Accept			json
//	@Produce		json
//	@Param			request	body		contracts.EnrichRequest	true	"Drawn area"
//	@Success		200		{object}	contracts.EnrichResponse
//	@Success		202		{object}	contracts.EnrichResponse
//	@Failure		400		{object}	contracts.ErrorResponse
//	@Failure		502		{object}	contracts.ErrorResponse
//	@Security		SessionAuth
//	@Router			/v1/city2tabula/enrich [post]
func (h *Handler) Enrich(c *gin.Context) {
	var req contracts.EnrichRequest
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
	resp := contracts.EnrichResponse{
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

// EnrichStatus godoc
//
//	@Summary		Poll a City2TABULA enrich run
//	@Description	Proxies the City2TABULA run status. When the run has completed and country and
//	@Description	osm_ids are given as query parameters, also returns the merge map for those buildings,
//	@Description	so the client polls one endpoint and gets data when ready.
//	@Tags			City2TABULA
//	@Produce		json
//	@Param			run_id	path		string	true	"Run id from the 202 enrich response"
//	@Param			country	query		string	false	"Country, required to receive data on completion"
//	@Param			osm_ids	query		string	false	"Comma-separated osm_ids, required to receive data on completion"
//	@Success		200		{object}	contracts.EnrichResponse
//	@Failure		400		{object}	contracts.ErrorResponse
//	@Failure		404		{object}	contracts.ErrorResponse	"No run with this id (stale or mistyped)"
//	@Failure		502		{object}	contracts.ErrorResponse
//	@Security		SessionAuth
//	@Router			/v1/city2tabula/enrich/{run_id} [get]
func (h *Handler) EnrichStatus(c *gin.Context) {
	runID := c.Param("run_id")
	if runID == "" {
		httputil.BadRequest(c, "run_id is required")
		return
	}

	ctx := c.Request.Context()
	log := logger.ForComponent("handler:city2tabula_enrich")

	run, err := h.client.GetRunStatus(ctx, runID)
	if errors.Is(err, c2t.ErrRunNotFound) {
		httputil.NotFound(c, "unknown run id: "+runID)
		return
	}
	if err != nil {
		log.Warnf("city2tabula run status failed for %s: %v", runID, err)
		httputil.BadGateway(c, "city2tabula unavailable")
		return
	}

	resp := contracts.EnrichResponse{
		Status: run.Status,
		RunID:  run.RunID,
		Data:   map[string]contracts.EnrichedBuilding{},
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
func mapBuildings(byOSMID map[string]c2t.Building) map[string]contracts.EnrichedBuilding {
	out := make(map[string]contracts.EnrichedBuilding, len(byOSMID))
	for osmID, b := range byOSMID {
		bb := contracts.BuemBuilding{
			Envelope: contracts.BuemEnvelope{Elements: c2t.EnvelopeElements(b)},
		}
		if b.NumberOfStoreys != nil {
			n := *b.NumberOfStoreys
			bb.NStoreys = &n
		}
		if b.RoomHeight != nil {
			bb.HRoom = &contracts.EnrichQuantity{Value: *b.RoomHeight, Unit: "m"}
		}
		if b.FootprintAreaSqm != nil {
			bb.FootprintArea = &contracts.EnrichQuantity{Value: *b.FootprintAreaSqm, Unit: "m2"}
		}
		out[osmID] = contracts.EnrichedBuilding{
			ObjectID:          b.ObjectID,
			MatchType:         b.MatchType,
			TabulaVariantCode: b.TabulaVariantCode,
			Buem:              contracts.BuemNode{Building: bb},
		}
	}
	return out
}
