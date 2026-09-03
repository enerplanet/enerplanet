package heatdemand

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"spatialhub_backend/internal/api/contracts"
)

func init() { gin.SetMode(gin.TestMode) }

func post(t *testing.T, body string) (*httptest.ResponseRecorder, contracts.HeatDemandResolveResponse) {
	t.Helper()
	w := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(w)
	c.Request = httptest.NewRequest(http.MethodPost, "/api/v1/heat-demand/resolve", strings.NewReader(body))
	c.Request.Header.Set("Content-Type", "application/json")
	NewHandler().Resolve(c)
	var resp contracts.HeatDemandResolveResponse
	if w.Body.Len() > 0 {
		_ = json.Unmarshal(w.Body.Bytes(), &resp)
	}
	return w, resp
}

func TestResolve_residentialReturnsEstimateWithWarning(t *testing.T) {
	w, resp := post(t, `{"osm_id":"111","f_class":"detached","floor_area_m2":120,"construction_year":1975}`)

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
	_, resp := post(t, `{"osm_id":"222","f_class":"office","floor_area_m2":200}`)

	assert.Equal(t, "estimate", resp.Source)
	assert.Equal(t, int64(16000), resp.HeatingDemandKwhA)
	for _, warning := range resp.Warnings {
		assert.NotContains(t, warning, "ignis")
	}
}

func TestResolve_missingFClass_400(t *testing.T) {
	w, _ := post(t, `{"osm_id":"333","floor_area_m2":100}`)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestResolve_badJSON_400(t *testing.T) {
	w, _ := post(t, `not json`)
	assert.Equal(t, http.StatusBadRequest, w.Code)
}
