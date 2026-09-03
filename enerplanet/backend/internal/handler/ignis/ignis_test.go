package ignis

import (
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func TestGetVariants_forwardsToIgnisAndReturnsBody(t *testing.T) {
	ignisService := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodGet, r.Method)
		assert.Equal(t, "/api/v1/variants/DE", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"country":"germany","data":["DE.N.SFH.01.Gen"]}`))
	}))
	defer ignisService.Close()

	handler := NewIgnisHandler(ignisService.URL)
	router := gin.New()
	router.GET("/v2/ignis/variants/:country_iso2", handler.GetVariants)

	req := httptest.NewRequest(http.MethodGet, "/v2/ignis/variants/DE", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "DE.N.SFH.01.Gen")
}

func TestMatchVariants_requiresTypeAndPeriod(t *testing.T) {
	handler := NewIgnisHandler("http://unused")
	router := gin.New()
	router.GET("/v2/ignis/variants/:country_iso2/match", handler.MatchVariants)

	req := httptest.NewRequest(http.MethodGet, "/v2/ignis/variants/DE/match", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadRequest, w.Code)
}

func TestMatchVariants_forwardsQueryParams(t *testing.T) {
	ignisService := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/api/v1/variants/DE/match", r.URL.Path)
		assert.Equal(t, "SFH", r.URL.Query().Get("type"))
		assert.Equal(t, "01", r.URL.Query().Get("period"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"country":"germany","prefix":"DE.N.SFH.01","data":[]}`))
	}))
	defer ignisService.Close()

	handler := NewIgnisHandler(ignisService.URL)
	router := gin.New()
	router.GET("/v2/ignis/variants/:country_iso2/match", handler.MatchVariants)

	req := httptest.NewRequest(http.MethodGet, "/v2/ignis/variants/DE/match?type=SFH&period=01", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
}

func TestCalculateHeatDemand_forwardsMethodPathAndBody(t *testing.T) {
	ignisService := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "/api/v1/calculate/DE.N.SFH.01.Gen", r.URL.Path)
		body, _ := io.ReadAll(r.Body)
		assert.JSONEq(t, `{"A_ref":150.0}`, string(body))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"variant_code":"DE.N.SFH.01.Gen","q_h_nd":123.45,"unit":"kWh/(m2.a)"}`))
	}))
	defer ignisService.Close()

	handler := NewIgnisHandler(ignisService.URL)
	router := gin.New()
	router.POST("/v2/ignis/calculate/:code", handler.CalculateHeatDemand)

	req := httptest.NewRequest(http.MethodPost, "/v2/ignis/calculate/DE.N.SFH.01.Gen", strings.NewReader(`{"A_ref":150.0}`))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	require.Equal(t, http.StatusOK, w.Code)
	assert.Contains(t, w.Body.String(), "123.45")
}

func TestForwardToIgnis_passesThrough4xxWithMessage(t *testing.T) {
	ignisService := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusNotFound)
		_, _ = w.Write([]byte(`{"error":"variant not found: XX.N.SFH.01.Gen"}`))
	}))
	defer ignisService.Close()

	handler := NewIgnisHandler(ignisService.URL)
	router := gin.New()
	router.POST("/v2/ignis/calculate/:code", handler.CalculateHeatDemand)

	req := httptest.NewRequest(http.MethodPost, "/v2/ignis/calculate/XX.N.SFH.01.Gen", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusNotFound, w.Code)
	assert.Contains(t, w.Body.String(), "variant not found: XX.N.SFH.01.Gen")
}

func TestForwardToIgnis_maps5xxToBadGateway(t *testing.T) {
	ignisService := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = w.Write([]byte(`{"error":"Failed to query variants"}`))
	}))
	defer ignisService.Close()

	handler := NewIgnisHandler(ignisService.URL)
	router := gin.New()
	router.GET("/v2/ignis/variants/:country_iso2", handler.GetVariants)

	req := httptest.NewRequest(http.MethodGet, "/v2/ignis/variants/DE", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadGateway, w.Code)
}

func TestForwardToIgnis_unreachableServiceIsBadGateway(t *testing.T) {
	handler := NewIgnisHandler("http://127.0.0.1:1")
	router := gin.New()
	router.GET("/v2/ignis/variants/:country_iso2", handler.GetVariants)

	req := httptest.NewRequest(http.MethodGet, "/v2/ignis/variants/DE", nil)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)

	assert.Equal(t, http.StatusBadGateway, w.Code)
}
