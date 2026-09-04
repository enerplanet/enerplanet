package heatdemand

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"spatialhub_backend/internal/api/contracts"
	"spatialhub_backend/internal/ignis"
)

func init() { gin.SetMode(gin.TestMode) }

// fakeIgnis is a hand-rolled hd.IgnisResolver so handler tests can exercise
// the ignis-success path without a live ignis server.
type fakeIgnis struct {
	code       string
	qHNDKwhM2a float64
}

func (f fakeIgnis) ExistingStateVariant(ctx context.Context, iso2, buildingType string, year int) (string, error) {
	return f.code, nil
}

func (f fakeIgnis) Calculate(ctx context.Context, variantCode string) (ignis.CalculateResult, error) {
	return ignis.CalculateResult{VariantCode: variantCode, QHNDKwhM2a: f.qHNDKwhM2a}, nil
}

func post(t *testing.T, resolver *Handler, body string) (*httptest.ResponseRecorder, contracts.HeatDemandResolveResponse) {
	t.Helper()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/heat-demand/resolve", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	resolver.Resolve(c)
	var resp contracts.HeatDemandResolveResponse
	if w.Body.Len() > 0 {
		_ = json.Unmarshal(w.Body.Bytes(), &resp)
	}
	return w, resp
}

func TestResolve_residentialWithoutCountryFallsBackToEstimate(t *testing.T) {
	h := &Handler{}
	w, resp := post(t, h, `{"osm_id":"111","f_class":"detached","floor_area_m2":120,"construction_year":1975}`)

	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "111", resp.OSMID)
	assert.Equal(t, "estimate", resp.Source)
	assert.Equal(t, int64(12000), resp.HeatingDemandKwhA)
	assert.Equal(t, float64(100), resp.SpecificHeatingDemandKwhM2a)
	assert.Nil(t, resp.TabulaVariantCode)
	assert.Nil(t, resp.HourlyProfile)
	assert.Equal(t, 1975, *resp.InputsEchoed.ConstructionYear)
	assert.NotEmpty(t, resp.Warnings)
}

func TestResolve_nonResidentialNoIgnisWarning(t *testing.T) {
	h := &Handler{}
	_, resp := post(t, h, `{"osm_id":"222","f_class":"office","floor_area_m2":200}`)

	assert.Equal(t, "estimate", resp.Source)
	assert.Equal(t, int64(16000), resp.HeatingDemandKwhA)
	for _, warning := range resp.Warnings {
		assert.NotContains(t, warning, "ignis")
	}
}

func TestResolve_residentialWithIgnisReturnsVariant(t *testing.T) {
	h := &Handler{ignis: fakeIgnis{code: "DE.N.SFH.05.Gen", qHNDKwhM2a: 100}}
	_, resp := post(t, h, `{"osm_id":"333","f_class":"detached","floor_area_m2":120,"construction_year":1975,"country":"germany"}`)

	assert.Equal(t, "ignis", resp.Source)
	assert.Equal(t, int64(12000), resp.HeatingDemandKwhA)
	require.NotNil(t, resp.TabulaVariantCode)
	assert.Equal(t, "DE.N.SFH.05.Gen", *resp.TabulaVariantCode)
}

func TestResolve_missingFClass_400(t *testing.T) {
	h := &Handler{}
	w, _ := post(t, h, `{"osm_id":"333","floor_area_m2":100}`)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestResolve_badJSON_400(t *testing.T) {
	h := &Handler{}
	w, _ := post(t, h, `not json`)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestNewHandler_buildsAnIgnisBackedHandler(t *testing.T) {
	h := NewHandler("http://localhost:0")
	require.NotNil(t, h.ignis)
}
