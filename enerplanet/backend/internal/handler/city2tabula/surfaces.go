package city2tabula

import (
	"net/http"

	"github.com/gin-gonic/gin"

	"platform.local/common/pkg/httputil"

	"spatialhub_backend/internal/api/contracts"
	c2t "spatialhub_backend/internal/city2tabula"
)

// SurfacesResponse is one page of LoD2 surfaces and the country it was read for.
type SurfacesResponse struct {
	Country string `json:"country" example:"germany"`
	c2t.SurfacesPage
}

// Surfaces godoc
//
//	@Summary		LoD2 roofs and walls of the buildings in an area
//	@Description	Returns one page of the LoD2 roof and wall polygons of every building whose
//	@Description	footprint intersects the bbox, in WGS84 with z as height above sea level, for
//	@Description	drawing the area in 3D. Each building lists its linked OSM ways, best match
//	@Description	first. Surface ids are the ids /v1/city2tabula/geometry and stored PV arrays
//	@Description	use. Pass next_cursor back as cursor until it is null. Without a country, the
//	@Description	country is worked out from the bbox centre and returned.
//	@Tags			City2TABULA
//	@Produce		json
//	@Param			country	query		string	false	"Country name, e.g. germany; case-insensitive. ISO2 codes are rejected"
//	@Param			xmin	query		number	true	"West longitude"
//	@Param			ymin	query		number	true	"South latitude"
//	@Param			xmax	query		number	true	"East longitude"
//	@Param			ymax	query		number	true	"North latitude"
//	@Param			cursor	query		string	false	"next_cursor of the previous page; omitted for the first page"
//	@Success		200		{object}	SurfacesResponse
//	@Failure		400		{object}	contracts.ErrorResponse
//	@Failure		502		{object}	contracts.ErrorResponse
//	@Security		SessionAuth
//	@Router			/v1/city2tabula/surfaces [get]
func (h *Handler) Surfaces(c *gin.Context) {
	bbox, err := parseBboxQuery(c)
	if err != nil {
		httputil.BadRequest(c, err.Error())
		return
	}
	country, err := h.resolveCountry(c.Request.Context(), contracts.EnrichRequest{
		Country: c.Query("country"),
		Bbox:    contracts.EnrichBbox{Xmin: bbox.Xmin, Ymin: bbox.Ymin, Xmax: bbox.Xmax, Ymax: bbox.Ymax},
	})
	if err != nil {
		httputil.BadRequest(c, err.Error())
		return
	}

	page, err := h.client.GetSurfacesInBBox(c.Request.Context(), country, bbox, c.Query("cursor"))
	if err != nil {
		writeC2TError(c, country, err)
		return
	}

	// Empty arrays rather than null, as Geometry does.
	if page.Buildings == nil {
		page.Buildings = []c2t.SurfacesBuilding{}
	}
	if page.Attributions == nil {
		page.Attributions = []c2t.DatasetCredit{}
	}
	c.JSON(http.StatusOK, SurfacesResponse{Country: country, SurfacesPage: page})
}
