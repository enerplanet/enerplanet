// Package pv serves one building's PV yield to the building configurator.
package pv

import (
	"context"
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"

	"platform.local/common/pkg/httputil"

	"spatialhub_backend/internal/api/contracts"
	"spatialhub_backend/internal/jobs"
	pvmodel "spatialhub_backend/internal/pv"
	weatherclient "spatialhub_backend/internal/weather"
)

// flatSurfaceTiltDeg is the tilt below which a surface counts as flat. The
// threshold is fixed; the request carries no flat-roof marker.
const flatSurfaceTiltDeg = 5

// yieldSource is implemented by jobs.PVResolver.
type yieldSource interface {
	AnnualYield(ctx context.Context, b jobs.BuildingYield) (float64, error)
}

// Handler serves POST /v1/pv/building-yield.
type Handler struct {
	yields yieldSource
}

// NewHandler returns a Handler computing yields with yields.
func NewHandler(yields yieldSource) *Handler {
	return &Handler{yields: yields}
}

// BuildingYield godoc
//
//	@Summary		PV yield of one building
//	@Description	Returns the building's PV generation in kWh over a full calendar year of the chosen
//	@Description	weather, the span of a BuEM run's totals. Send weather_scenario or weather_year, not both.
//	@Description	A request that needs new simulation can take up to 30 s; repeat requests for unchanged
//	@Description	arrays return faster.
//	@Tags			PV
//	@Accept			json
//	@Produce		json
//	@Param			request	body		contracts.PVBuildingYieldRequest	true	"Arrays, location and weather"
//	@Success		200		{object}	contracts.PVBuildingYieldResponse
//	@Failure		400		{object}	contracts.ErrorResponse	"Invalid arrays, location or weather; fix the request"
//	@Failure		502		{object}	contracts.ErrorResponse	"The weather or PV service failed; retrying later may help"
//	@Security		SessionAuth
//	@Router			/v1/pv/building-yield [post]
func (h *Handler) BuildingYield(c *gin.Context) {
	var req contracts.PVBuildingYieldRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, "invalid PV yield request: "+err.Error())
		return
	}
	b, err := buildingYield(req)
	if err != nil {
		httputil.BadRequest(c, err.Error())
		return
	}
	kwh, err := h.yields.AnnualYield(c.Request.Context(), b)
	if err != nil {
		httputil.BadGateway(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, contracts.PVBuildingYieldResponse{AnnualKWh: kwh})
}

// buildingYield validates req and turns it into the resolver's input.
func buildingYield(req contracts.PVBuildingYieldRequest) (jobs.BuildingYield, error) {
	if req.OSMID == "" {
		return jobs.BuildingYield{}, fmt.Errorf("osm_id is required")
	}
	if req.Lat < -90 || req.Lat > 90 || req.Lon < -180 || req.Lon > 180 {
		return jobs.BuildingYield{}, fmt.Errorf("lat and lon must be WGS84 degrees, got %v, %v", req.Lat, req.Lon)
	}
	if req.WeatherProvider != "" && !weatherclient.IsProvider(req.WeatherProvider) {
		return jobs.BuildingYield{}, fmt.Errorf("weather_provider must be cosmo-rea6, era5-land or merra-2, got %s", req.WeatherProvider)
	}
	period, err := weatherclient.RequestedPeriod(req.WeatherScenario, req.WeatherYear)
	if err != nil {
		return jobs.BuildingYield{}, err
	}
	if len(req.Arrays) == 0 {
		return jobs.BuildingYield{}, fmt.Errorf("arrays must list at least one array")
	}
	arrays := make([]pvmodel.Array, len(req.Arrays))
	for i, a := range req.Arrays {
		if a.Area <= 0 || a.UsableShare <= 0 || a.UsableShare > 1 {
			return jobs.BuildingYield{}, fmt.Errorf("array %q needs an area above 0 and a usable_share in (0, 1], got %v and %v", a.SurfaceID, a.Area, a.UsableShare)
		}
		arrays[i] = surfaceArray(a)
	}
	module := make(map[string]interface{}, len(req.Module))
	for k, v := range req.Module {
		module[k] = v
	}
	return jobs.BuildingYield{
		OSMID: req.OSMID, Location: pvmodel.Location{Lat: req.Lat, Lon: req.Lon},
		Period: period, Provider: req.WeatherProvider, Module: module, Arrays: arrays,
	}, nil
}

// surfaceArray is the array a surface carries: racked south-facing panels on a
// flat one, else modules in the surface's own orientation.
func surfaceArray(a contracts.PVArray) pvmodel.Array {
	out := pvmodel.Array{SurfaceID: a.SurfaceID, Tilt: a.Tilt, Azimuth: a.Azimuth, AreaSqm: a.Area, UsableShare: a.UsableShare, CapacityKW: a.CapacityKW}
	if a.Tilt < flatSurfaceTiltDeg {
		flat := pvmodel.FlatRoofArray(a.SurfaceID, a.Area)
		out.Tilt, out.Azimuth = flat.Tilt, flat.Azimuth
	}
	return out
}
