package city2tabula

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
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

// bremenCredit is one attributions entry as City2TABULA v0.8.0 returns it,
// credit_url and terms_url being omitted when the dataset has none.
const bremenCredit = `{"dataset_id":"de-hb-lod2","provider":"Landesamt GeoInformation Bremen",
  "dataset":"LoD2 Land Bremen","licence":"CC-BY-4.0","licence_url":"https://creativecommons.org/licenses/by/4.0/",
  "credit":"Quellenvermerk: Landesamt GeoInformation Bremen","changes":"derived"}`

func TestGetBuildingsByOSMIDs_ParsesBuildingsAndCredits(t *testing.T) {
	tc, target, payload := fakeTentacron(t, completed(`{"buildings":[{"object_id":"DE123","dataset_id":"de-hb-lod2","osm_id":"789012","match_type":1,"footprint_area":100.5}],
	  "attributions":[`+bremenCredit+`]}`))

	got, err := NewClient(tc).GetBuildingsByOSMIDs(context.Background(), "germany", []string{"123456", "789012"})

	require.NoError(t, err)
	require.Len(t, got.Buildings, 1)
	assert.Equal(t, "789012", got.Buildings[0].OSMID)
	assert.Equal(t, int16(1), got.Buildings[0].MatchType)
	assert.Equal(t, "de-hb-lod2", got.Buildings[0].DatasetID)
	require.Len(t, got.Attributions, 1)
	assert.Equal(t, "Quellenvermerk: Landesamt GeoInformation Bremen", got.Attributions[0].Credit)
	assert.Empty(t, got.Attributions[0].CreditURL)
	assert.Equal(t, "c2t-buildings", *target)
	assert.Equal(t, map[string]any{"country": "germany", "osm_ids": "123456,789012"}, *payload)
}

func TestGetBuildingsByOSMIDs_EmptyEnvelopeIsEmpty(t *testing.T) {
	tc, _, _ := fakeTentacron(t, completed(`{"buildings":[],"attributions":[]}`))

	got, err := NewClient(tc).GetBuildingsByOSMIDs(context.Background(), "germany", []string{"1"})

	require.NoError(t, err)
	assert.Empty(t, got.Buildings)
	assert.Empty(t, got.Attributions)
}

func TestGetBuildingsByOSMIDs_BareArrayIsAnError(t *testing.T) {
	tc, _, _ := fakeTentacron(t, completed(`[{"object_id":"DE123","osm_id":"789012","match_type":1}]`))

	_, err := NewClient(tc).GetBuildingsByOSMIDs(context.Background(), "germany", []string{"789012"})

	require.Error(t, err, "a pre-0.8.0 City2TABULA answers with a bare array, which must fail rather than read as no buildings")
}

func TestGetBuildingsByOSMIDs_EmptyInputSkipsRequest(t *testing.T) {
	got, err := NewClient(tentacron.New("http://unused", "k")).
		GetBuildingsByOSMIDs(context.Background(), "germany", nil)

	require.NoError(t, err)
	assert.Empty(t, got.Buildings)
}

// oneBuildingWithSurfaces is City2TABULA's geometry response when surfaces were
// asked for: the footprint as before, plus one polygon per envelope face.
const oneBuildingWithSurfaces = `{"buildings":[{
  "object_id":"NL_1",
  "dataset_id":"nl-3dbag",
  "footprint_geojson":{"type":"Polygon","coordinates":[[[1,2],[3,4],[1,2]]]},
  "surfaces":[
    {"id":"s1","type":"WallSurface","geojson":{"type":"Polygon","crs":{"type":"name","properties":{"name":"EPSG:28992"}},"coordinates":[[[1,2,3],[4,5,6],[1,2,3]]]}},
    {"id":"s2","type":"RoofSurface","geojson":{"type":"Polygon","coordinates":[[[7,8,9],[1,2,3],[7,8,9]]]}}
  ]
}],"attributions":[{"dataset_id":"nl-3dbag","provider":"3DBAG","dataset":"3DBAG","licence":"CC-BY-4.0",
  "licence_url":"https://creativecommons.org/licenses/by/4.0/","credit":"© 3DBAG by tudelft3d and 3DGI","changes":"derived"}]}`

func TestGetSurfaceGeometryByObjectIDs_AsksForSurfacesAndKeepsThemRaw(t *testing.T) {
	tc, target, payload := fakeTentacron(t, completed(oneBuildingWithSurfaces))

	got, err := NewClient(tc).GetSurfaceGeometryByObjectIDs(context.Background(), "netherlands", []string{"NL_1"})

	require.NoError(t, err)
	assert.Equal(t, "c2t-geometry", *target)
	assert.Equal(t, "surfaces", (*payload)["include"],
		"unconsumed payload fields reach City2TABULA as query parameters")

	require.Len(t, got.Buildings, 1)
	b := got.Buildings[0]
	require.Len(t, b.Surfaces, 2)
	assert.Equal(t, "s1", b.Surfaces[0].ID)
	assert.Equal(t, "WallSurface", b.Surfaces[0].Type)
	assert.Contains(t, string(b.Surfaces[0].GeoJSON), "EPSG:28992",
		"the crs member survives, which is why the polygon stays raw")
	assert.NotEmpty(t, b.FootprintGeoJSON, "the footprint still comes back alongside")
	assert.Equal(t, "nl-3dbag", b.DatasetID)
	require.Len(t, got.Attributions, 1)
	assert.Equal(t, "© 3DBAG by tudelft3d and 3DGI", got.Attributions[0].Credit)
}

func TestGetGeometryByObjectIDs_DoesNotAskForSurfaces(t *testing.T) {
	tc, _, payload := fakeTentacron(t, completed(`{"buildings":[{"object_id":"NL_1"}],"attributions":[]}`))

	_, err := NewClient(tc).GetGeometryByObjectIDs(context.Background(), "netherlands", []string{"NL_1"})

	require.NoError(t, err)
	assert.NotContains(t, *payload, "include",
		"the drawn-area call places buildings on a map; surfaces there risk breaching TentaCron's 10 MiB response cap, which fails the job whole")
}

func TestGetSurfaceGeometry_NoSurfaceRowsIsNotAnError(t *testing.T) {
	tc, _, _ := fakeTentacron(t, completed(`{"buildings":[{"object_id":"NL_1","footprint_geojson":{"type":"Polygon","coordinates":[]}}],"attributions":[]}`))

	got, err := NewClient(tc).GetSurfaceGeometryByObjectIDs(context.Background(), "netherlands", []string{"NL_1"})

	require.NoError(t, err)
	require.Len(t, got.Buildings, 1)
	assert.Empty(t, got.Buildings[0].Surfaces, "City2TABULA omits the key entirely, so absent and empty are one case")
}

// A building comes back once; the requested way standing for it is its best
// way when that was asked for, otherwise its first requested way.
func TestByRequestedWay(t *testing.T) {
	r := BuildingsResult{Buildings: []Building{
		{ObjectID: "A", OSMID: "best", OSMIDs: []string{"best", "f1", "f2"}},
		{ObjectID: "B", OSMID: "other", OSMIDs: []string{"other", "f3", "f4"}},
		{ObjectID: "C", OSMID: "old"}, // a server before 0.11.2
	}}
	byWay, further := r.ByRequestedWay([]string{"best", "f1", "f2", "f3", "f4", "old"})

	if byWay["best"][0].ObjectID != "A" || byWay["f3"][0].ObjectID != "B" || byWay["old"][0].ObjectID != "C" || len(byWay) != 3 {
		t.Errorf("byWay = %v, want A under best, B under f3 (its best way was not asked for), C under old", byWay)
	}
	want := map[string]string{"f1": "best", "f2": "best", "f4": "f3"}
	if len(further) != len(want) || further["f1"] != "best" || further["f2"] != "best" || further["f4"] != "f3" {
		t.Errorf("further = %v, want %v", further, want)
	}
}

// A way covering two 3D buildings stands for one and is never further on the
// other, so it keeps its own building's data.
func TestByRequestedWay_standingWayIsNeverFurther(t *testing.T) {
	r := BuildingsResult{Buildings: []Building{
		{ObjectID: "A", OSMID: "w", OSMIDs: []string{"w"}},
		{ObjectID: "B", OSMID: "x", OSMIDs: []string{"x", "w"}},
	}}
	_, further := r.ByRequestedWay([]string{"w", "x"})
	if _, ok := further["w"]; ok {
		t.Errorf("further = %v, want w left out", further)
	}
}

// A terraced row mapped as one OSM outline: the way stands for every 3D
// building it covers, largest first, so none of them is dropped.
func TestByRequestedWay_keepsEveryBuildingOfAWayLargestFirst(t *testing.T) {
	area := func(v float64) *float64 { return &v }
	r := BuildingsResult{Buildings: []Building{
		{ObjectID: "DEBY_small", OSMID: "1001832407", OSMIDs: []string{"1001832407"}, FloorAreaSqm: area(90)},
		{ObjectID: "DEBY_large", OSMID: "1001832407", OSMIDs: []string{"1001832407"}, FloorAreaSqm: area(140)},
		{ObjectID: "DEBY_same_b", OSMID: "1001832407", OSMIDs: []string{"1001832407"}, FloorAreaSqm: area(90)},
	}}
	byWay, further := r.ByRequestedWay([]string{"1001832407"})

	var got []string
	for _, b := range byWay["1001832407"] {
		got = append(got, b.ObjectID)
	}
	want := []string{"DEBY_large", "DEBY_same_b", "DEBY_small"}
	if strings.Join(got, ",") != strings.Join(want, ",") || len(further) != 0 {
		t.Errorf("buildings = %v, further = %v; want %v (largest first, ties by object id) and no further ways", got, further, want)
	}
}

// A c2t: key is looked up by object id and comes back under that key, next
// to the buildings found by OSM way; a shared credit is listed once.
func TestGetBuildingsByOSMIDs_routesObjectKeys(t *testing.T) {
	var payloads []map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			var body struct {
				Payload map[string]any `json:"payload"`
			}
			require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
			payloads = append(payloads, body.Payload)
			w.WriteHeader(http.StatusAccepted)
			fmt.Fprintf(w, `{"id":"req-%d"}`, len(payloads))
			return
		}
		if strings.HasSuffix(r.URL.Path, "/req-1") {
			_, _ = w.Write([]byte(completed(`{"buildings":[{"object_id":"DE1","osm_id":"w1","osm_ids":["w1"],"match_type":1}],"attributions":[` + bremenCredit + `]}`)))
			return
		}
		_, _ = w.Write([]byte(completed(`{"buildings":[{"object_id":"DE2","osm_id":"","osm_ids":[],"match_type":2}],"attributions":[` + bremenCredit + `]}`)))
	}))
	t.Cleanup(srv.Close)

	got, err := NewClient(tentacron.New(srv.URL, "k")).GetBuildingsByOSMIDs(context.Background(), "germany", []string{"w1", ObjectKey("DE2")})

	require.NoError(t, err)
	require.Len(t, payloads, 2)
	assert.Equal(t, "w1", payloads[0]["osm_ids"])
	assert.Equal(t, "DE2", payloads[1]["object_ids"])
	require.Len(t, got.Buildings, 2)
	assert.Equal(t, "c2t:DE2", got.Buildings[1].OSMID)
	assert.Equal(t, []string{"c2t:DE2"}, got.Buildings[1].OSMIDs)
	byWay, _ := got.ByRequestedWay([]string{"w1", "c2t:DE2"})
	assert.Equal(t, "DE2", byWay["c2t:DE2"][0].ObjectID)
	assert.Len(t, got.Attributions, 1)
}
