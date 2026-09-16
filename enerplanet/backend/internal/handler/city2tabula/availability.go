package city2tabula

import (
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"github.com/gin-gonic/gin"

	"platform.local/common/pkg/httputil"
	"platform.local/platform/logger"

	"spatialhub_backend/internal/api/contracts"
	c2t "spatialhub_backend/internal/city2tabula"
	"spatialhub_backend/internal/models"
)

// availabilityComponent is this endpoint's log component name.
const availabilityComponent = "handler:heat_availability"

// gridRegions is the PyLovo grid-extent source Availability reads. Satisfied
// by *region.Store; faked in tests.
type gridRegions interface {
	GridRegionsOverlapping(west, south, east, north float64) ([]models.CachedRegion, error)
}

// Availability godoc
//
//	@Summary		Report whether heat modelling is available for an area
//	@Description	Answers, for a drawn area, whether it can be modelled now ("ready"), needs only a
//	@Description	City2TABULA link run over data that is already there ("linkable"), or is missing one
//	@Description	of the two datasets entirely ("partial"). has_3d_data and has_grid say which half is
//	@Description	missing in the last case.
//	@Tags			City2TABULA
//	@Produce		json
//	@Param			country	query		string	true	"Country"	example(netherlands)
//	@Param			xmin	query		number	true	"Area west edge (WGS84 lon)"
//	@Param			ymin	query		number	true	"Area south edge (WGS84 lat)"
//	@Param			xmax	query		number	true	"Area east edge (WGS84 lon)"
//	@Param			ymax	query		number	true	"Area north edge (WGS84 lat)"
//	@Success		200		{object}	contracts.HeatAvailabilityResponse
//	@Failure		400		{object}	contracts.ErrorResponse
//	@Failure		500		{object}	contracts.ErrorResponse
//	@Failure		502		{object}	contracts.ErrorResponse
//	@Security		SessionAuth
//	@Router			/v1/heat/availability [get]
func (h *Handler) Availability(c *gin.Context) {
	country := strings.TrimSpace(c.Query("country"))
	if country == "" {
		httputil.BadRequest(c, "country is required")
		return
	}
	bbox, err := parseBboxQuery(c)
	if err != nil {
		httputil.BadRequest(c, err.Error())
		return
	}

	log := logger.ForComponent(availabilityComponent)

	regions, err := h.grid.GridRegionsOverlapping(bbox.Xmin, bbox.Ymin, bbox.Xmax, bbox.Ymax)
	if err != nil {
		log.Errorf("grid region lookup failed: %v", err)
		httputil.InternalError(c, "could not read grid coverage")
		return
	}

	ctx := c.Request.Context()
	linked, err := h.client.GetCoverage(ctx, country, bbox)
	if err != nil {
		writeC2TError(c, country, err)
		return
	}

	// A matched building is also a building, so the second call is only worth
	// making when nothing matched: it is the one case where the answer turns
	// on whether there is 3D data here at all.
	has3D := linked > 0
	if linked == 0 {
		inArea, err := h.client.GetBuildingsInBBox(ctx, country, bbox)
		if err != nil {
			writeC2TError(c, country, err)
			return
		}
		has3D = len(inArea) > 0
	}

	resp := contracts.HeatAvailabilityResponse{
		Status:          availabilityStatus(linked > 0, has3D, len(regions) > 0),
		LinkedBuildings: linked,
		Has3DData:       has3D,
		HasGrid:         len(regions) > 0,
		GridRegions:     regionNames(regions),
	}
	resp.Available = resp.Status == "ready"
	c.JSON(http.StatusOK, resp)
}

// logAreaGeometryFailure records a geometry call that failed without failing
// the area request, so an area answered without footprints is traceable.
func logAreaGeometryFailure(country string, err error) {
	logger.ForComponent("handler:city2tabula_area").
		Warnf("city2tabula geometry for %s failed, returning attributes without footprints: %v", country, err)
}

// upstreamRejectedMessage stands in for an upstream service's own rejection
// text. That text reaches a browser from here, and carries database names,
// schema names and container paths; it goes to the log instead.
const upstreamRejectedMessage = "city2tabula could not serve this request"

// writeC2TError answers a failed City2TABULA call: its own rejection of the
// request as a 400, anything else as a 502. Either way the client gets a
// fixed message and the detail goes to the log.
func writeC2TError(c *gin.Context, country string, err error) {
	if badReq := new(c2t.BadRequestError); errors.As(err, &badReq) {
		logger.ForComponent(availabilityComponent).
			Warnf("city2tabula rejected the availability lookup for %s: %s", country, badReq.Message)
		httputil.BadRequest(c, upstreamRejectedMessage)
		return
	}
	logger.ForComponent(availabilityComponent).Warnf("city2tabula availability lookup for %s failed: %v", country, err)
	httputil.BadGateway(c, "city2tabula unavailable")
}

// parseBboxQuery reads the four bbox query parameters as a WGS84 lon/lat box.
func parseBboxQuery(c *gin.Context) (c2t.Bbox, error) {
	var b c2t.Bbox
	for _, f := range []struct {
		name string
		dst  *float64
	}{{"xmin", &b.Xmin}, {"ymin", &b.Ymin}, {"xmax", &b.Xmax}, {"ymax", &b.Ymax}} {
		raw := c.Query(f.name)
		v, err := strconv.ParseFloat(raw, 64)
		if err != nil {
			return b, fmt.Errorf("%s must be a number, got %q", f.name, raw)
		}
		*f.dst = v
	}
	if b.Xmin >= b.Xmax || b.Ymin >= b.Ymax {
		return b, fmt.Errorf("bbox is empty or inverted: xmin %v ymin %v xmax %v ymax %v", b.Xmin, b.Ymin, b.Xmax, b.Ymax)
	}
	if b.Xmin < -180 || b.Xmax > 180 || b.Ymin < -90 || b.Ymax > 90 {
		return b, fmt.Errorf("bbox is outside WGS84 bounds: xmin %v ymin %v xmax %v ymax %v", b.Xmin, b.Ymin, b.Xmax, b.Ymax)
	}
	return b, nil
}

// availabilityStatus names what the area needs next: nothing, a link run, or
// the dataset it is missing.
func availabilityStatus(linked, has3D, hasGrid bool) string {
	switch {
	case linked:
		return "ready"
	case has3D && hasGrid:
		return "linkable"
	default:
		return "partial"
	}
}

// regionNames renders the overlapping regions as "<country_code>/<state_code>".
func regionNames(regions []models.CachedRegion) []string {
	if len(regions) == 0 {
		return nil
	}
	names := make([]string, 0, len(regions))
	for _, r := range regions {
		names = append(names, r.CountryCode+"/"+r.StateCode)
	}
	return names
}
