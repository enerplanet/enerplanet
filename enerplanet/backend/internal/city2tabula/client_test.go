package city2tabula

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestGetCoverage_ParsesResponseAndCountryVocabulary(t *testing.T) {
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.RequestURI()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"count": 42}`))
	}))
	defer server.Close()

	client := NewClient(server.URL)
	count, err := client.GetCoverage(context.Background(), "uk", Bbox{Xmin: 1, Ymin: 2, Xmax: 3, Ymax: 4})

	require.NoError(t, err)
	assert.Equal(t, 42, count)
	assert.Contains(t, gotPath, "country=united_kingdom")
	assert.Contains(t, gotPath, "xmin=1")
}

func TestTriggerRun_ReturnsRun(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "/api/v1/runs", r.URL.Path)
		w.WriteHeader(http.StatusAccepted)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"run_id":"abc123","country":"germany","status":"pending"}`))
	}))
	defer server.Close()

	client := NewClient(server.URL)
	run, err := client.TriggerRun(context.Background(), "germany", Bbox{Xmin: 1, Ymin: 2, Xmax: 3, Ymax: 4})

	require.NoError(t, err)
	assert.Equal(t, "abc123", run.RunID)
	assert.Equal(t, "pending", run.Status)
}

func TestGetRunStatus_ReturnsRun(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/api/v1/runs/abc123", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"run_id":"abc123","country":"germany","status":"completed"}`))
	}))
	defer server.Close()

	client := NewClient(server.URL)
	run, err := client.GetRunStatus(context.Background(), "abc123")

	require.NoError(t, err)
	assert.Equal(t, "completed", run.Status)
}

func TestGetRunStatus_NotFoundIsErrRunNotFound(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusNotFound)
	}))
	defer server.Close()

	client := NewClient(server.URL)
	_, err := client.GetRunStatus(context.Background(), "does-not-exist")

	assert.ErrorIs(t, err, ErrRunNotFound)
}

func TestGetRunStatus_UnexpectedStatusIsError(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	client := NewClient(server.URL)
	_, err := client.GetRunStatus(context.Background(), "boom")

	assert.Error(t, err)
	assert.NotErrorIs(t, err, ErrRunNotFound)
}

func TestGetBuildingsByOSMIDs_BadRequestCarriesMessage(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"error":"unsupported country \"string\": no TABULA data available"}`))
	}))
	defer server.Close()

	client := NewClient(server.URL)
	_, err := client.GetBuildingsByOSMIDs(context.Background(), "string", []string{"1"})

	var badReq *BadRequestError
	require.ErrorAs(t, err, &badReq)
	assert.Contains(t, badReq.Message, "unsupported country")
}

func TestGetBuildingsByBBox_ParsesBuildings(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, "/api/v1/buildings", r.URL.Path)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{"object_id":"DE123","osm_id":"","match_type":2,"footprint_area":100.5,"surfaces":[{"id":"s1","type":"WallSurface","area":12.5,"tilt":0,"azimuth":180}]}]`))
	}))
	defer server.Close()

	client := NewClient(server.URL)
	buildings, err := client.GetBuildingsByBBox(context.Background(), "germany", Bbox{Xmin: 1, Ymin: 2, Xmax: 3, Ymax: 4})

	require.NoError(t, err)
	require.Len(t, buildings, 1)
	assert.Equal(t, "DE123", buildings[0].ObjectID)
	assert.Equal(t, int16(2), buildings[0].MatchType)
	require.NotNil(t, buildings[0].FootprintAreaSqm)
	assert.Equal(t, 100.5, *buildings[0].FootprintAreaSqm)
	require.Len(t, buildings[0].Surfaces, 1)
	assert.Equal(t, "WallSurface", buildings[0].Surfaces[0].Type)
}

func TestGetBuildingsByOSMIDs_ParsesBuildingsAndQuery(t *testing.T) {
	var gotPath string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.RequestURI()
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`[{"object_id":"DE123","osm_id":"789012","match_type":1,"footprint_area":100.5}]`))
	}))
	defer server.Close()

	client := NewClient(server.URL)
	buildings, err := client.GetBuildingsByOSMIDs(context.Background(), "germany", []string{"123456", "789012"})

	require.NoError(t, err)
	assert.Contains(t, gotPath, "osm_ids=123456%2C789012")
	require.Len(t, buildings, 1)
	assert.Equal(t, "789012", buildings[0].OSMID)
	assert.Equal(t, int16(1), buildings[0].MatchType)
}

func TestGetBuildingsByOSMIDs_EmptyInputSkipsRequest(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		t.Fatal("no request should be made for an empty osm_ids list")
	}))
	defer server.Close()

	client := NewClient(server.URL)
	buildings, err := client.GetBuildingsByOSMIDs(context.Background(), "germany", nil)

	require.NoError(t, err)
	assert.Nil(t, buildings)
}
