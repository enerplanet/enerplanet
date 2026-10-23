package pv

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"spatialhub_backend/internal/jobs"
)

type fakeYields struct {
	got jobs.BuildingYield
	kwh float64
	err error
}

func (f *fakeYields) AnnualYield(_ context.Context, b jobs.BuildingYield) (float64, error) {
	f.got = b
	return f.kwh, f.err
}

func post(h *Handler, body string) *httptest.ResponseRecorder {
	gin.SetMode(gin.TestMode)
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/pv/building-yield", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	h.BuildingYield(c)
	return w
}

func TestBuildingYield_PlacesFlatPanelsAndPassesTheWeather(t *testing.T) {
	yields := &fakeYields{kwh: 6120.5}
	w := post(NewHandler(yields), `{"osm_id":"7","lat":48.8,"lon":12.9,"weather_provider":"era5-land","weather_scenario":"p10",
		"module":{"losses":0.1},"arrays":[
		{"surface_id":"flat","tilt":2,"azimuth":0,"area":100,"usable_share":0.8},
		{"surface_id":"south","tilt":35,"azimuth":180,"area":40,"usable_share":0.5}]}`)

	require.Equal(t, http.StatusOK, w.Code, w.Body.String())
	assert.JSONEq(t, `{"annual_kwh":6120.5}`, w.Body.String())
	assert.Equal(t, "era5-land", yields.got.Provider)
	assert.Equal(t, "p10", yields.got.Period.Scenario)
	assert.Equal(t, 0.1, yields.got.Module["losses"])
	flat, south := yields.got.Arrays[0], yields.got.Arrays[1]
	assert.Equal(t, [2]float64{15, 180}, [2]float64{flat.Tilt, flat.Azimuth}, "a flat surface carries south-facing panels")
	assert.Equal(t, [2]float64{35, 180}, [2]float64{south.Tilt, south.Azimuth})
	assert.Equal(t, 100.0, flat.AreaSqm)
}

func TestBuildingYield_RejectsInvalidRequests(t *testing.T) {
	for name, body := range map[string]string{
		"no arrays":         `{"osm_id":"7","lat":48.8,"lon":12.9,"arrays":[]}`,
		"share above one":   `{"osm_id":"7","lat":48.8,"lon":12.9,"arrays":[{"surface_id":"a","tilt":30,"azimuth":180,"area":10,"usable_share":1.5}]}`,
		"unknown archive":   `{"osm_id":"7","lat":48.8,"lon":12.9,"weather_provider":"x","arrays":[{"surface_id":"a","tilt":30,"azimuth":180,"area":10,"usable_share":0.8}]}`,
		"scenario and year": `{"osm_id":"7","lat":48.8,"lon":12.9,"weather_scenario":"p50","weather_year":2018,"arrays":[{"surface_id":"a","tilt":30,"azimuth":180,"area":10,"usable_share":0.8}]}`,
		"latitude":          `{"osm_id":"7","lat":120,"lon":12.9,"arrays":[{"surface_id":"a","tilt":30,"azimuth":180,"area":10,"usable_share":0.8}]}`,
	} {
		t.Run(name, func(t *testing.T) {
			assert.Equal(t, http.StatusBadRequest, post(NewHandler(&fakeYields{}), body).Code)
		})
	}
}

func TestBuildingYield_ReportsAFailedService(t *testing.T) {
	w := post(NewHandler(&fakeYields{err: errors.New("pv-service timeout")}),
		`{"osm_id":"7","lat":48.8,"lon":12.9,"arrays":[{"surface_id":"a","tilt":30,"azimuth":180,"area":10,"usable_share":0.8}]}`)
	assert.Equal(t, http.StatusBadGateway, w.Code)
	assert.Contains(t, w.Body.String(), "pv-service timeout")
}
