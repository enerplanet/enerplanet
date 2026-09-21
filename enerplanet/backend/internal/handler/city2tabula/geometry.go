package city2tabula

import (
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"

	"platform.local/common/pkg/httputil"

	c2t "spatialhub_backend/internal/city2tabula"
)

// maxGeometryObjectIDs caps how many buildings one call may ask for. City2TABULA's
// own handler allows surfaces for a single object_id, and TentaCron fails a job
// whole when a response exceeds upstream.max_response_bytes, which a building with
// many surfaces can reach on its own (see GetSurfaceGeometryByObjectIDs).
const maxGeometryObjectIDs = 1

// Geometry godoc
//
//	@Summary		Envelope surface geometry for a building
//	@Description	Returns the building's footprint and every envelope surface polygon, for
//	@Description	rendering it in 3D. Surface ids are the City2TABULA surface row ids that the
//	@Description	BuEM envelope elements carry, so a clicked face resolves back to its element
//	@Description	without a second lookup. Geometry is in the country's storage CRS, not WGS84.
//	@Description	One building per call.
//	@Tags			City2TABULA
//	@Produce		json
//	@Param			country		query		string	true	"Country name, e.g. germany. Case-insensitive. Not an ISO2 code: City2TABULA derives its database from this name"
//	@Param			object_ids	query		string	true	"City2TABULA building object_id"
//	@Success		200			{array}		c2t.BuildingGeometry
//	@Failure		400			{object}	contracts.ErrorResponse
//	@Failure		502			{object}	contracts.ErrorResponse
//	@Security		SessionAuth
//	@Router			/v1/city2tabula/geometry [get]
func (h *Handler) Geometry(c *gin.Context) {
	country := strings.TrimSpace(c.Query("country"))
	if country == "" {
		httputil.BadRequest(c, "country is required")
		return
	}

	objectIDs := splitObjectIDs(c.Query("object_ids"))
	if len(objectIDs) == 0 {
		httputil.BadRequest(c, "object_ids is required")
		return
	}
	if len(objectIDs) > maxGeometryObjectIDs {
		httputil.BadRequest(c, "object_ids accepts one building per call")
		return
	}

	geometries, err := h.client.GetSurfaceGeometryByObjectIDs(c.Request.Context(), country, objectIDs)
	if err != nil {
		writeC2TError(c, country, err)
		return
	}

	// An array even for one id, and an empty array rather than null for an
	// unknown one: a caller that takes the first element keeps working if the
	// single-building cap is ever lifted.
	if geometries == nil {
		geometries = []c2t.BuildingGeometry{}
	}
	c.JSON(http.StatusOK, geometries)
}

// splitObjectIDs reads the comma-separated object_ids parameter, dropping empty
// entries so a trailing comma is not a missing id.
func splitObjectIDs(raw string) []string {
	ids := make([]string, 0, 1)
	for part := range strings.SplitSeq(raw, ",") {
		if trimmed := strings.TrimSpace(part); trimmed != "" {
			ids = append(ids, trimmed)
		}
	}
	return ids
}
