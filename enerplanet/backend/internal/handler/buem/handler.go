// Package buem is the HTTP handler for the per-building BuEM run behind the
// building configurator, where a person edits an envelope and waits for the
// new profile.
//
// It is the interactive counterpart to the run_buem job: one building instead
// of a model, the caller's envelope instead of a City2TABULA lookup, and the
// hourly series returned inline instead of written to CSV. Everything reaches
// buem-gateway and weather-serve through TentaCron, as the job does.
package buem

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"

	"platform.local/common/pkg/httputil"

	"spatialhub_backend/internal/api/contracts"
	buemclient "spatialhub_backend/internal/buem"
	"spatialhub_backend/internal/geo"
	"spatialhub_backend/internal/tentacron"
	weatherclient "spatialhub_backend/internal/weather"
)

// Handler serves the per-building BuEM run.
type Handler struct {
	buem     *buemclient.Client
	weather  *weatherclient.Client
	provider string
}

// NewHandler returns a Handler reaching buem-gateway and weather-serve through
// TentaCron, with provider naming the weather-serve dataset.
func NewHandler(tc *tentacron.Client, provider string) *Handler {
	return &Handler{
		buem:     buemclient.NewClient(tc),
		weather:  weatherclient.NewClient(tc),
		provider: provider,
	}
}

// RunBuilding godoc
//
//	@Summary		Run BuEM for a single building
//	@Description	Runs one building through BuEM with the envelope the caller supplies, and returns
//	@Description	BuEM's block for it including the hourly series. Unlike a model run, the envelope
//	@Description	is taken from the request rather than looked up in City2TABULA, so a building that
//	@Description	has no 3D match, or whose surfaces a user has edited, can still be run. The
//	@Description	building block is forwarded to buem-gateway verbatim and must be complete: no
//	@Description	U-value resolution or archetype default is applied here.
//	@Tags			BuEM
//	@Accept			json
//	@Produce		json
//	@Param			request	body		contracts.BuemBuildingRunRequest	true	"Building geometry and BuEM building block"
//	@Success		200		{object}	contracts.BuemBuildingRunResponse
//	@Failure		400		{object}	contracts.ErrorResponse
//	@Failure		502		{object}	contracts.ErrorResponse
//	@Security		SessionAuth
//	@Router			/v1/buem/building [post]
func (h *Handler) RunBuilding(c *gin.Context) {
	var req contracts.BuemBuildingRunRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, "invalid request payload")
		return
	}
	if len(req.Building) == 0 {
		httputil.BadRequest(c, "building is required")
		return
	}
	if len(req.Geometry) == 0 {
		httputil.BadRequest(c, "geometry is required")
		return
	}

	// weather-serve resolves one point per request, and buem-gateway requires a
	// complete weather block for every building, so the year has to be known
	// before anything is called.
	start, err := time.Parse(time.RFC3339, req.StartDate)
	if err != nil {
		httputil.BadRequest(c, "start_date must be an RFC3339 timestamp, got "+req.StartDate)
		return
	}

	xmin, ymin, xmax, ymax, err := geo.BBoxFromGeoJSON(req.Geometry)
	if err != nil {
		httputil.BadRequest(c, "geometry is not usable GeoJSON: "+err.Error())
		return
	}
	lon, lat := (xmin+xmax)/2, (ymin+ymax)/2

	ctx := c.Request.Context()
	weather, err := h.weather.GetPointWeather(ctx, lat, lon, start.Year(), h.provider)
	if err != nil {
		httputil.BadGateway(c, "weather-serve did not return a series for this building: "+err.Error())
		return
	}

	result, err := h.buem.RunBuilding(ctx, buemclient.Building{
		ID:       req.OSMID,
		Geometry: req.Geometry,
		Building: req.Building,
	}, weather, req.StartDate, req.EndDate, req.Resolution, req.ModelID)
	if err != nil {
		// buem-gateway rejecting the body is the caller's envelope being wrong,
		// which is a 400 they can act on; anything else is the chain being down.
		var badRequest *buemclient.BadRequestError
		if errors.As(err, &badRequest) {
			httputil.BadRequest(c, badRequest.Message)
			return
		}
		httputil.BadGateway(c, "BuEM did not complete for this building: "+err.Error())
		return
	}
	// A per-building rejection comes back inside a 200 batch, because one bad
	// building never fails a model run. Here it is the whole request.
	if result.Error != "" {
		httputil.BadRequest(c, result.Error)
		return
	}

	c.JSON(http.StatusOK, contracts.BuemBuildingRunResponse{
		OSMID: req.OSMID,
		BUEM:  json.RawMessage(result.BUEM),
	})
}
