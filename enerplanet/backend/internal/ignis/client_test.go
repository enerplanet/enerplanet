package ignis

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestISO2ForCountry(t *testing.T) {
	code, ok := ISO2ForCountry("germany")
	require.True(t, ok)
	assert.Equal(t, "DE", code)

	code, ok = ISO2ForCountry("UK")
	require.True(t, ok)
	assert.Equal(t, "GB", code)

	_, ok = ISO2ForCountry("atlantis")
	assert.False(t, ok)
}

func TestMatchVariants_forwardsTypeAndYear(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/api/v1/variants/DE/match", r.URL.Path)
		assert.Equal(t, "SFH", r.URL.Query().Get("type"))
		assert.Equal(t, "1975", r.URL.Query().Get("year"))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"country":"germany","prefix":"DE.N.SFH.05","data":[{"code":"DE.N.SFH.05.Gen","label":"Existing state"}]}`))
	}))
	defer server.Close()

	client := NewClient(server.URL)
	matches, err := client.MatchVariants(context.Background(), "DE", "SFH", 1975)

	require.NoError(t, err)
	require.Len(t, matches, 1)
	assert.Equal(t, "DE.N.SFH.05.Gen", matches[0].Code)
}

func TestExistingStateVariant_noMatchIsErrNoVariant(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"country":"germany","prefix":"DE.N.SFH.99","data":[]}`))
	}))
	defer server.Close()

	client := NewClient(server.URL)
	_, err := client.ExistingStateVariant(context.Background(), "DE", "SFH", 1000)

	assert.ErrorIs(t, err, ErrNoVariant)
}

func TestMatchVariants_badRequestCarriesMessage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"query params 'type' and 'period' are required"}`))
	}))
	defer server.Close()

	client := NewClient(server.URL)
	_, err := client.MatchVariants(context.Background(), "DE", "", 1975)

	var badReq *BadRequestError
	require.ErrorAs(t, err, &badReq)
	assert.Contains(t, badReq.Message, "required")
}

func TestGetEnvelopeUValues_extractsWallRoofFloor(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/api/v1/data/DE.N.SFH.05.Gen", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"country": "germany",
			"variant_code": "DE.N.SFH.05.Gen",
			"tabula_data": {
				"AdvancedParameters": {
					"Uvalues": {
						"U_Wall_1": 1.2,
						"U_Roof_1": 0.9,
						"U_Floor_1": 1.1,
						"U_Window_1": 2.8
					}
				}
			}
		}`))
	}))
	defer server.Close()

	client := NewClient(server.URL)
	u, err := client.GetEnvelopeUValues(context.Background(), "DE.N.SFH.05.Gen")

	require.NoError(t, err)
	assert.Equal(t, 1.2, u.Wall)
	assert.Equal(t, 0.9, u.Roof)
	assert.Equal(t, 1.1, u.Floor)
}

func TestCalculate_sendsEmptyBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "/api/v1/calculate/DE.N.SFH.05.Gen", r.URL.Path)
		body := make([]byte, r.ContentLength)
		_, _ = r.Body.Read(body)
		assert.JSONEq(t, `{}`, string(body))
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"variant_code":"DE.N.SFH.05.Gen","q_h_nd":100.5,"unit":"kWh/(m2.a)"}`))
	}))
	defer server.Close()

	client := NewClient(server.URL)
	result, err := client.Calculate(context.Background(), "DE.N.SFH.05.Gen")

	require.NoError(t, err)
	assert.Equal(t, 100.5, result.QHNDKwhM2a)
}
