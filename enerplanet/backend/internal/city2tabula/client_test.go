package city2tabula

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"spatialhub_backend/internal/tentacron"
)

// fakeTentacron serves the submit + single-poll TentaCron exchange, replying to
// the status GET with statusBody. It records the target and payload it received.
func fakeTentacron(t *testing.T, statusBody string) (*tentacron.Client, *string, *map[string]any) {
	t.Helper()
	var gotTarget string
	var gotPayload map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/requests":
			var body struct {
				Target  string         `json:"target"`
				Payload map[string]any `json:"payload"`
			}
			require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
			gotTarget, gotPayload = body.Target, body.Payload
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"req-1"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/requests/req-1":
			_, _ = w.Write([]byte(statusBody))
		default:
			t.Fatalf("unexpected %s %s", r.Method, r.URL)
		}
	}))
	t.Cleanup(srv.Close)
	return tentacron.New(srv.URL, "k"), &gotTarget, &gotPayload
}

func completed(targetResponse string) string {
	return `{"state":"completed","result":{"target_status":200,"target_response":` + targetResponse + `}}`
}

func failed(code, message string) string {
	b, _ := json.Marshal(struct {
		State string `json:"state"`
		Error struct {
			Code    string `json:"code"`
			Message string `json:"message"`
		} `json:"error"`
	}{State: "failed"})
	_ = b
	e := map[string]any{"state": "failed", "error": map[string]string{"code": code, "message": message}}
	out, _ := json.Marshal(e)
	return string(out)
}

func TestTriggerRun_ReturnsRunAndSendsBboxPayload(t *testing.T) {
	tc, target, payload := fakeTentacron(t, completed(`{"run_id":"abc123","country":"united_kingdom","status":"pending"}`))

	run, err := NewClient(tc).TriggerRun(context.Background(), "uk", Bbox{Xmin: 1, Ymin: 2, Xmax: 3, Ymax: 4})

	require.NoError(t, err)
	assert.Equal(t, "abc123", run.RunID)
	assert.Equal(t, "pending", run.Status)
	assert.Equal(t, "c2t-trigger-run", *target)
	assert.Equal(t, map[string]any{
		"country": "united_kingdom",
		"xmin":    float64(1), "ymin": float64(2), "xmax": float64(3), "ymax": float64(4),
	}, *payload)
}

func TestGetRunStatus_ReturnsRun(t *testing.T) {
	tc, target, payload := fakeTentacron(t, completed(`{"run_id":"abc123","status":"completed"}`))

	run, err := NewClient(tc).GetRunStatus(context.Background(), "abc123")

	require.NoError(t, err)
	assert.Equal(t, "completed", run.Status)
	assert.Equal(t, "c2t-run-status", *target)
	assert.Equal(t, map[string]any{"run_id": "abc123"}, *payload)
}

func TestGetRunStatus_UpstreamNotFoundIsErrRunNotFound(t *testing.T) {
	tc, _, _ := fakeTentacron(t, failed("target_error", `target c2t-run-status: HTTP 404: {"error":"run not found"}`))

	_, err := NewClient(tc).GetRunStatus(context.Background(), "stale")

	assert.ErrorIs(t, err, ErrRunNotFound)
}

func TestGetRunStatus_UpstreamServerErrorStaysOpaque(t *testing.T) {
	tc, _, _ := fakeTentacron(t, failed("target_error", "target c2t-run-status: HTTP 500: pq: relation \"runs\" does not exist"))

	_, err := NewClient(tc).GetRunStatus(context.Background(), "boom")

	require.Error(t, err)
	assert.NotErrorIs(t, err, ErrRunNotFound)
	var badReq *BadRequestError
	assert.NotErrorAs(t, err, &badReq)
}

func TestTriggerRun_UpstreamBadRequestCarriesMessage(t *testing.T) {
	tc, _, _ := fakeTentacron(t, failed("target_error", `target c2t-trigger-run: HTTP 400: {"error":"unsupported country \"atlantis\""}`))

	_, err := NewClient(tc).TriggerRun(context.Background(), "atlantis", Bbox{})

	var badReq *BadRequestError
	require.ErrorAs(t, err, &badReq)
	assert.Contains(t, badReq.Message, "unsupported country")
}

func TestTriggerRun_TimeoutStaysOpaque(t *testing.T) {
	tc, _, _ := fakeTentacron(t, failed("target_timeout", "target c2t-trigger-run timed out after 30s"))

	_, err := NewClient(tc).TriggerRun(context.Background(), "germany", Bbox{})

	require.Error(t, err)
	var badReq *BadRequestError
	assert.NotErrorAs(t, err, &badReq)
	te, ok := tentacron.AsTargetError(err)
	require.True(t, ok)
	assert.Equal(t, "target_timeout", te.Code)
}

func TestGetBuildingsByOSMIDs_ParsesBuildingsAndJoinsOSMIDs(t *testing.T) {
	tc, target, payload := fakeTentacron(t, completed(`[{"object_id":"DE123","osm_id":"789012","match_type":1,"footprint_area":100.5}]`))

	buildings, err := NewClient(tc).GetBuildingsByOSMIDs(context.Background(), "germany", []string{"123456", "789012"})

	require.NoError(t, err)
	require.Len(t, buildings, 1)
	assert.Equal(t, "789012", buildings[0].OSMID)
	assert.Equal(t, int16(1), buildings[0].MatchType)
	assert.Equal(t, "c2t-buildings", *target)
	assert.Equal(t, map[string]any{"country": "germany", "osm_ids": "123456,789012"}, *payload)
}

func TestGetBuildingsByOSMIDs_NullResultIsNilSlice(t *testing.T) {
	tc, _, _ := fakeTentacron(t, completed(`null`))

	buildings, err := NewClient(tc).GetBuildingsByOSMIDs(context.Background(), "germany", []string{"1"})

	require.NoError(t, err)
	assert.Nil(t, buildings)
}

func TestGetBuildingsByOSMIDs_EmptyInputSkipsRequest(t *testing.T) {
	buildings, err := NewClient(tentacron.New("http://unused", "k")).
		GetBuildingsByOSMIDs(context.Background(), "germany", nil)

	require.NoError(t, err)
	assert.Nil(t, buildings)
}

// oneBuildingWithSurfaces is City2TABULA's geometry response when surfaces were
// asked for: the footprint as before, plus one polygon per envelope face.
const oneBuildingWithSurfaces = `[{
  "object_id":"NL_1",
  "footprint_geojson":{"type":"Polygon","coordinates":[[[1,2],[3,4],[1,2]]]},
  "surfaces":[
    {"id":"s1","type":"WallSurface","geojson":{"type":"Polygon","crs":{"type":"name","properties":{"name":"EPSG:28992"}},"coordinates":[[[1,2,3],[4,5,6],[1,2,3]]]}},
    {"id":"s2","type":"RoofSurface","geojson":{"type":"Polygon","coordinates":[[[7,8,9],[1,2,3],[7,8,9]]]}}
  ]
}]`

func TestGetSurfaceGeometryByObjectIDs_AsksForSurfacesAndKeepsThemRaw(t *testing.T) {
	tc, target, payload := fakeTentacron(t, completed(oneBuildingWithSurfaces))

	got, err := NewClient(tc).GetSurfaceGeometryByObjectIDs(context.Background(), "netherlands", []string{"NL_1"})

	require.NoError(t, err)
	assert.Equal(t, "c2t-geometry", *target)
	assert.Equal(t, "surfaces", (*payload)["include"],
		"unconsumed payload fields reach City2TABULA as query parameters")

	require.Len(t, got, 1)
	require.Len(t, got[0].Surfaces, 2)
	assert.Equal(t, "s1", got[0].Surfaces[0].ID)
	assert.Equal(t, "WallSurface", got[0].Surfaces[0].Type)
	assert.Contains(t, string(got[0].Surfaces[0].GeoJSON), "EPSG:28992",
		"the crs member survives, which is why the polygon stays raw")
	assert.NotEmpty(t, got[0].FootprintGeoJSON, "the footprint still comes back alongside")
}

func TestGetGeometryByObjectIDs_DoesNotAskForSurfaces(t *testing.T) {
	tc, _, payload := fakeTentacron(t, completed(`[{"object_id":"NL_1"}]`))

	_, err := NewClient(tc).GetGeometryByObjectIDs(context.Background(), "netherlands", []string{"NL_1"})

	require.NoError(t, err)
	assert.NotContains(t, *payload, "include",
		"the drawn-area call places buildings on a map; an area's worth of surfaces is tens of megabytes")
}

func TestGetSurfaceGeometry_NoSurfaceRowsIsNotAnError(t *testing.T) {
	tc, _, _ := fakeTentacron(t, completed(`[{"object_id":"NL_1","footprint_geojson":{"type":"Polygon","coordinates":[]}}]`))

	got, err := NewClient(tc).GetSurfaceGeometryByObjectIDs(context.Background(), "netherlands", []string{"NL_1"})

	require.NoError(t, err)
	require.Len(t, got, 1)
	assert.Empty(t, got[0].Surfaces, "City2TABULA omits the key entirely, so absent and empty are one case")
}
