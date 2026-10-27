package city2tabula

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"platform.local/common/pkg/httputil"

	"spatialhub_backend/internal/api/contracts"
	"spatialhub_backend/internal/pv"
)

// PVSurfaces godoc
//
//	@Summary		Roof and wall surfaces of a building for PV
//	@Description	Returns every roof and outer wall of the building with its area, tilt from horizontal
//	@Description	and azimuth clockwise from north, whether automatic PV placement uses it (roofs only)
//	@Description	and whether it is suggested for PV. When the OSM way covers several 3D buildings, every building's
//	@Description	surfaces are returned, each with the object_id of its building.
//	@Description	Empty when City2TABULA has no 3D data for the building.
//	@Tags			City2TABULA
//	@Produce		json
//	@Param			osm_id	query		string	true	"OSM id of the building"
//	@Param			country	query		string	false	"Country name, e.g. germany; case-insensitive. ISO2 codes are rejected. Resolved from lon and lat when absent"
//	@Param			lon		query		number	false	"Building longitude (WGS84), when country is absent"
//	@Param			lat		query		number	false	"Building latitude (WGS84), when country is absent"
//	@Success		200		{object}	contracts.PVSurfacesResponse
//	@Failure		400		{object}	contracts.ErrorResponse
//	@Failure		502		{object}	contracts.ErrorResponse
//	@Security		SessionAuth
//	@Router			/v1/city2tabula/pv-surfaces [get]
func (h *Handler) PVSurfaces(c *gin.Context) {
	osmID := strings.TrimSpace(c.Query("osm_id"))
	if osmID == "" {
		httputil.BadRequest(c, "osm_id is required")
		return
	}
	country, err := h.pointCountry(c)
	if err != nil {
		httputil.BadRequest(c, err.Error())
		return
	}

	result, err := h.client.GetBuildingsByOSMIDs(c.Request.Context(), country, []string{osmID})
	if err != nil {
		writeC2TError(c, country, err)
		return
	}

	surfaces := []pv.Surface{}
	for _, b := range result.Buildings {
		for _, s := range pv.Surfaces(b.Surfaces) {
			s.ObjectID = b.ObjectID
			surfaces = append(surfaces, s)
		}
	}
	c.JSON(http.StatusOK, contracts.PVSurfacesResponse{Country: country, Surfaces: surfaces})
}

// pointCountry returns the country query parameter, or resolves it from lon and lat.
func (h *Handler) pointCountry(c *gin.Context) (string, error) {
	if country := strings.TrimSpace(c.Query("country")); country != "" {
		return country, nil
	}
	lon, errLon := strconv.ParseFloat(c.Query("lon"), 64)
	lat, errLat := strconv.ParseFloat(c.Query("lat"), 64)
	if errLon != nil || errLat != nil || h.country == nil {
		return "", errors.New("country, or lon and lat, are required")
	}
	country, err := h.country.Resolve(c.Request.Context(), json.RawMessage(fmt.Sprintf(`{"type":"Point","coordinates":[%g,%g]}`, lon, lat)))
	if err != nil {
		return "", fmt.Errorf("could not resolve the country at %g, %g: %w", lon, lat, err)
	}
	return country, nil
}
