package city2tabula

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"platform.local/common/pkg/httputil"

	"spatialhub_backend/internal/api/contracts"
	c2t "spatialhub_backend/internal/city2tabula"
)

// EnrichArea godoc
//
//	@Summary		Resolve City2TABULA 3D data for an area, without osm_ids
//	@Description	Returns every LOD2 building City2TABULA holds inside the bbox with its BuEM
//	@Description	envelope and footprint, keyed by object_id. Unlike the osm_ids endpoint this
//	@Description	needs no building list, so a caller with only an area can fetch 3D data. The
//	@Description	trade-off is identity: City2TABULA's area query cannot report the PyLovo link,
//	@Description	so the result carries no osm_id and cannot be joined to demand profiles.
//	@Description	Footprints are in the country's storage CRS, not WGS84.
//	@Tags			City2TABULA
//	@Accept			json
//	@Produce		json
//	@Param			request	body		contracts.AreaEnrichRequest	true	"Area"
//	@Success		200		{object}	contracts.AreaEnrichResponse
//	@Failure		400		{object}	contracts.ErrorResponse
//	@Failure		502		{object}	contracts.ErrorResponse
//	@Security		SessionAuth
//	@Router			/v1/city2tabula/enrich/area [post]
func (h *Handler) EnrichArea(c *gin.Context) {
	var req contracts.AreaEnrichRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, "invalid request payload")
		return
	}
	country := strings.TrimSpace(req.Country)
	if country == "" {
		httputil.BadRequest(c, "country is required")
		return
	}
	bbox := c2t.Bbox{Xmin: req.Bbox.Xmin, Ymin: req.Bbox.Ymin, Xmax: req.Bbox.Xmax, Ymax: req.Bbox.Ymax}
	if bbox.Xmin >= bbox.Xmax || bbox.Ymin >= bbox.Ymax {
		httputil.BadRequest(c, "bbox is empty or inverted")
		return
	}

	ctx := c.Request.Context()
	buildings, err := h.client.GetBuildingsInBBox(ctx, country, bbox)
	if err != nil {
		writeC2TError(c, country, err)
		return
	}

	byObjectID := make(map[string]c2t.Building, len(buildings))
	objectIDs := make([]string, 0, len(buildings))
	for _, b := range buildings {
		if b.ObjectID == "" {
			continue
		}
		byObjectID[b.ObjectID] = b
		objectIDs = append(objectIDs, b.ObjectID)
	}

	// Geometry is a second call because no other City2TABULA response carries
	// it. A failure here degrades to attributes without footprints rather than
	// failing the request: the envelope data is still useful on its own.
	footprints := make(map[string]([]byte), len(objectIDs))
	if geometry, gerr := h.client.GetGeometryByObjectIDs(ctx, country, objectIDs); gerr == nil {
		for _, g := range geometry {
			if len(g.FootprintGeoJSON) > 0 {
				footprints[g.ObjectID] = g.FootprintGeoJSON
			}
		}
	} else {
		logAreaGeometryFailure(country, gerr)
	}

	mapped := h.mapBuildings(ctx, byObjectID)
	data := make(map[string]contracts.AreaBuilding, len(mapped))
	for objectID, enriched := range mapped {
		data[objectID] = contracts.AreaBuilding{
			EnrichedBuilding: enriched,
			FootprintGeoJSON: footprints[objectID],
		}
	}

	c.JSON(http.StatusOK, contracts.AreaEnrichResponse{
		Total:        len(data),
		WithGeometry: len(footprints),
		Data:         data,
	})
}
