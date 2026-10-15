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
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"

	"platform.local/common/pkg/httputil"

	"platform.local/common/pkg/models"

	"spatialhub_backend/internal/api/contracts"
	buemclient "spatialhub_backend/internal/buem"
	"spatialhub_backend/internal/geo"
	seriesstore "spatialhub_backend/internal/store/series"
	"spatialhub_backend/internal/tentacron"
	weatherclient "spatialhub_backend/internal/weather"
)

// ModelAccess loads a model the caller may edit, answering the request itself
// when it may not. Satisfied by the model handler.
type ModelAccess interface {
	EditableModel(c *gin.Context, id string) (*models.Model, bool)
}

// Handler serves the per-building BuEM runs.
type Handler struct {
	buem        *buemclient.Client
	weather     *weatherclient.Client
	provider    string
	series      *seriesstore.Store
	buemVersion string
	models      ModelAccess
}

// NewHandler returns a Handler reaching buem-gateway and weather-serve through
// TentaCron, with provider naming the weather-serve dataset. Stored runs key
// their results for buemVersion and check model access through access.
func NewHandler(tc *tentacron.Client, provider string, store *seriesstore.Store, buemVersion string, access ModelAccess) *Handler {
	return &Handler{
		buem:        buemclient.NewClient(tc),
		weather:     weatherclient.NewClient(tc),
		provider:    provider,
		series:      store,
		buemVersion: buemVersion,
		models:      access,
	}
}

// RunBuilding godoc
//
//	@Summary		Run BuEM for a single building
//	@Description	Runs one building through BuEM with the envelope the caller supplies, and returns
//	@Description	BuEM's block for it including the hourly series. Unlike a model run, the envelope
//	@Description	is taken from the request rather than looked up in City2TABULA, so a building that
//	@Description	has no 3D match, or whose surfaces a user has edited, can still be run. The
//	@Description	building block is forwarded to buem-gateway as sent and must be complete: no
//	@Description	U-value resolution or archetype default is applied here. The one addition: a block
//	@Description	that sets neither building.thermal.comfortT_lb nor comfortT_ub gets 18 and 21 degC.
//	@Description	weather_provider selects the weather archive; omitted, the backend default applies.
//	@Description	weather_scenario (p10, p50, p90) or weather_year selects the weather, at most one;
//	@Description	with neither, p50. The run covers that full calendar year hourly (1900 for a
//	@Description	scenario); start_date and end_date are ignored.
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
	p, ok := h.prepare(c)
	if !ok {
		return
	}
	result, ok := h.run(c, p, p.req.ModelID)
	if !ok {
		return
	}
	c.JSON(http.StatusOK, contracts.BuemBuildingRunResponse{
		OSMID: p.req.OSMID,
		BUEM:  json.RawMessage(result.BUEM),
	})
}

// prepared is a validated run request with its building and weather.
type prepared struct {
	req        contracts.BuemBuildingRunRequest
	building   buemclient.Building
	weather    json.RawMessage
	start, end string
}

// prepare binds and validates the request and fetches the building's weather,
// answering the request itself on any failure.
func (h *Handler) prepare(c *gin.Context) (prepared, bool) {
	var req contracts.BuemBuildingRunRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, "invalid request payload")
		return prepared{}, false
	}
	if len(req.Building) == 0 {
		httputil.BadRequest(c, "building is required")
		return prepared{}, false
	}
	if len(req.Geometry) == 0 {
		httputil.BadRequest(c, "geometry is required")
		return prepared{}, false
	}
	period, err := requestPeriod(req)
	if err != nil {
		httputil.BadRequest(c, err.Error())
		return prepared{}, false
	}
	provider := h.provider
	if req.WeatherProvider != "" {
		if !weatherclient.IsProvider(req.WeatherProvider) {
			httputil.BadRequest(c, "weather_provider must be cosmo-rea6, era5-land or merra-2, got "+req.WeatherProvider)
			return prepared{}, false
		}
		provider = req.WeatherProvider
	}
	xmin, ymin, xmax, ymax, err := geo.BBoxFromGeoJSON(req.Geometry)
	if err != nil {
		httputil.BadRequest(c, "geometry is not usable GeoJSON: "+err.Error())
		return prepared{}, false
	}
	start, end := period.Range()
	weather, err := h.weather.GetPointWeather(c.Request.Context(), (ymin+ymax)/2, (xmin+xmax)/2, period, provider)
	if err != nil {
		httputil.BadGateway(c, "weather-serve did not return a series for this building: "+err.Error())
		return prepared{}, false
	}
	b := buemclient.Building{ID: req.OSMID, Geometry: req.Geometry, Building: req.Building, Solver: req.Solver}
	return prepared{req: req, building: b, weather: weather, start: start, end: end}, true
}

// run runs one building through BuEM with its hourly series, answering the
// request itself on any failure.
func (h *Handler) run(c *gin.Context, p prepared, modelID string) (buemclient.BuildingResult, bool) {
	result, err := h.buem.RunBuilding(c.Request.Context(), p.building, p.weather, p.start, p.end, p.req.Resolution, modelID)
	if err != nil {
		// buem-gateway rejecting the body is the caller's envelope being wrong,
		// which is a 400 they can act on; anything else is the chain being down.
		var badRequest *buemclient.BadRequestError
		if errors.As(err, &badRequest) {
			httputil.BadRequest(c, badRequest.Message)
			return buemclient.BuildingResult{}, false
		}
		httputil.BadGateway(c, "BuEM did not complete for this building: "+err.Error())
		return buemclient.BuildingResult{}, false
	}
	// A per-building rejection comes back inside a 200 batch, because one bad
	// building never fails a model run. Here it is the whole request.
	if result.Error != "" {
		httputil.BadRequest(c, result.Error)
		return buemclient.BuildingResult{}, false
	}
	return result, true
}

// requestPeriod reads the run's weather from the request: a validation year, a
// scenario, or the typical scenario when neither is given.
func requestPeriod(req contracts.BuemBuildingRunRequest) (weatherclient.Period, error) {
	switch {
	case req.WeatherScenario != "" && req.WeatherYear != 0:
		return weatherclient.Period{}, fmt.Errorf("send weather_scenario or weather_year, not both; got %q and %d", req.WeatherScenario, req.WeatherYear)
	case req.WeatherYear < 0:
		return weatherclient.Period{}, fmt.Errorf("weather_year must be a positive year, got %d", req.WeatherYear)
	case req.WeatherYear > 0:
		return weatherclient.Period{Year: req.WeatherYear}, nil
	case req.WeatherScenario == "":
		return weatherclient.DefaultPeriod, nil
	case !weatherclient.IsScenario(req.WeatherScenario):
		return weatherclient.Period{}, fmt.Errorf("weather_scenario must be p10, p50 or p90, got %q", req.WeatherScenario)
	default:
		return weatherclient.Period{Scenario: req.WeatherScenario}, nil
	}
}
