package jobs

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	commonModels "platform.local/common/pkg/models"
	"spatialhub_backend/internal/buem"
	"spatialhub_backend/internal/city2tabula"
	"spatialhub_backend/internal/ignis"
	"spatialhub_backend/internal/models"
	"spatialhub_backend/internal/tentacron"
)

// fakeRunStore is a hand-rolled city2tabulaRunStore.
type fakeRunStore struct {
	rec    *models.ModelCity2TabulaRun
	saved  []string
	status []string
}

func (f *fakeRunStore) Save(modelID uint, runID, country, status string) error {
	f.saved = append(f.saved, runID)
	f.rec = &models.ModelCity2TabulaRun{ModelID: modelID, RunID: runID, Country: country, Status: status}
	return nil
}
func (f *fakeRunStore) UpdateStatus(modelID uint, status, errMsg string) error {
	f.status = append(f.status, status)
	return nil
}
func (f *fakeRunStore) Get(modelID uint) (*models.ModelCity2TabulaRun, error) { return f.rec, nil }

func floatPtr(f float64) *float64 { return &f }
func boolPtr(b bool) *bool        { return &b }

// The surface-to-envelope mapping moved to internal/city2tabula
// (city2tabula.EnvelopeElements); its tests live in
// internal/city2tabula/envelope_test.go.

func TestBuildingsForBuem_CollectsByOSMIDWithGeometryAndEnvelope(t *testing.T) {
	building := func(osmID string) map[string]interface{} {
		return map[string]interface{}{
			"geometry": map[string]interface{}{"type": "Point", "coordinates": []interface{}{12.5, 48.5}},
			"properties": map[string]interface{}{
				"feature_type": "BasePOI",
				"osm_id":       osmID,
			},
		}
	}
	transformer := map[string]interface{}{
		"geometry": map[string]interface{}{"type": "Point", "coordinates": []interface{}{12.6, 48.6}},
		"properties": map[string]interface{}{
			"feature_type": "TopologyNode",
			"osm_id":       "Trafo_1",
		},
	}

	topology := []interface{}{
		map[string]interface{}{"from": building("111"), "to": transformer},
		map[string]interface{}{"from": building("222")}, // no envelope match
	}

	envelopeByOSMID := map[string]city2tabula.Building{
		"111": {
			OSMID: "111",
			Surfaces: []city2tabula.Surface{
				{ID: "w1", Type: "WallSurface", AreaSqm: floatPtr(20), Azimuth: floatPtr(90), Tilt: floatPtr(0)},
			},
		},
	}

	buildings, resolved, unresolved := buildingsForBuem(context.Background(), nil, "germany", topology, envelopeByOSMID, ignis.RefurbishmentExisting, cookingSettings{Carrier: CookingGas, IncludeDHW: false})

	require.Len(t, buildings, 1, "only building 111 has a resolved envelope; the transformer and building 222 must be excluded")
	assert.Equal(t, "111", buildings[0].ID)
	assert.JSONEq(t, `{"type":"Point","coordinates":[12.5,48.5]}`, string(buildings[0].Geometry))
	assert.Contains(t, resolved, "111")
	assert.Contains(t, unresolved, "222", "no envelope match must be recorded, not silently dropped")
	assert.NotContains(t, unresolved, "Trafo_1", "a non-building node must not be recorded at all")

	var block map[string]interface{}
	require.NoError(t, json.Unmarshal(buildings[0].Building, &block))
	assert.Contains(t, block, "envelope")
	assert.NotContains(t, block, "weather", "weather must not be attached per building — RunBuildings sends it once, shared")
	assert.Equal(t, "gas", block["cooking_carrier"], "model-level cooking default reaches the building block")
	assert.Equal(t, false, block["include_dhw"])
}

func TestMergeBuemResults_WritesByOSMIDAndSkipsFailures(t *testing.T) {
	building := func(osmID string) map[string]interface{} {
		return map[string]interface{}{
			"properties": map[string]interface{}{"feature_type": "BasePOI", "osm_id": osmID},
		}
	}
	topology := []interface{}{
		map[string]interface{}{"from": building("111")},
		map[string]interface{}{"from": building("222")}, // BuEM rejected this one
	}

	results := []buem.BuildingResult{
		{ID: "111", BUEM: json.RawMessage(`{"thermal_load_profile":{}}`)},
		{ID: "222", Error: "building.envelope is required"},
	}

	mergeBuemResults(logrus.NewEntry(logrus.New()), topology, results)

	matched := topology[0].(map[string]interface{})["from"].(map[string]interface{})["properties"].(map[string]interface{})
	require.Contains(t, matched, "buem", "building 111 succeeded, should be enriched")

	failed := topology[1].(map[string]interface{})["from"].(map[string]interface{})["properties"].(map[string]interface{})
	assert.NotContains(t, failed, "buem", "building 222's result carried an error, must be left alone")
}

// fakeTentacronC2T stands up a fake TentaCron whose every target call is
// answered by respond(target) -> (upstreamStatus, jsonBody): a 2xx yields a
// completed job carrying jsonBody as target_response, anything else a failed
// job whose target_error message carries the status (as real TentaCron reports
// an upstream HTTP failure). respond runs on the status poll, so a counter in
// its closure sees each call.
func fakeTentacronC2T(t *testing.T, respond func(target string) (int, string)) *city2tabula.Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/requests":
			var req struct {
				Target string `json:"target"`
			}
			require.NoError(t, json.NewDecoder(r.Body).Decode(&req))
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"` + req.Target + `"}`))
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/v1/requests/"):
			target := strings.TrimPrefix(r.URL.Path, "/v1/requests/")
			status, body := respond(target)
			if status >= 200 && status < 300 {
				_, _ = w.Write([]byte(`{"state":"completed","result":{"target_status":200,"target_response":` + body + `}}`))
				return
			}
			_, _ = w.Write([]byte(`{"state":"failed","error":{"code":"target_error","message":"target ` + target +
				`: HTTP ` + strconv.Itoa(status) + `: ` + body + `"}}`))
		default:
			t.Fatalf("unexpected %s %s", r.Method, r.URL)
		}
	}))
	t.Cleanup(srv.Close)
	return city2tabula.NewClient(tentacron.New(srv.URL, "k"))
}

func topologyBuildings(osmIDs ...string) []interface{} {
	topology := make([]interface{}, len(osmIDs))
	for i, id := range osmIDs {
		topology[i] = map[string]interface{}{
			"from": map[string]interface{}{
				"properties": map[string]interface{}{"feature_type": "BasePOI", "osm_id": id},
			},
		}
	}
	return topology
}

// TestResolveEnvelope_PartialCoverageTriggersRunForMissingBuildings covers
// the scenario where one user's polygon already linked building "111", and a
// second, overlapping-but-different polygon needs "111" and "222" — "222" was
// never processed. A bbox-level coverage count (count > 0) would have seen
// "111" and wrongly concluded the whole area was covered.
func TestResolveEnvelope_PartialCoverageTriggersRunForMissingBuildings(t *testing.T) {
	var buildingsCalls int32
	var runTriggered bool

	client := fakeTentacronC2T(t, func(target string) (int, string) {
		switch target {
		case "c2t-buildings":
			if atomic.AddInt32(&buildingsCalls, 1) == 1 {
				return 200, `[{"object_id":"DE1","osm_id":"111","match_type":1}]`
			}
			return 200, `[{"object_id":"DE1","osm_id":"111","match_type":1},{"object_id":"DE2","osm_id":"222","match_type":1}]`
		case "c2t-trigger-run":
			runTriggered = true
			return 200, `{"run_id":"run1","country":"germany","status":"pending"}`
		case "c2t-run-status":
			return 200, `{"run_id":"run1","country":"germany","status":"completed"}`
		}
		t.Fatalf("unexpected target %s", target)
		return 0, ""
	})
	log := logrus.NewEntry(logrus.New())
	bbox := city2tabula.Bbox{Xmin: 1, Ymin: 2, Xmax: 3, Ymax: 4}

	result := resolveEnvelope(context.Background(), log, client, nil, commonModels.Model{ID: 1}, "germany", bbox, topologyBuildings("111", "222"))

	assert.True(t, runTriggered, "a run must be triggered when the topology needs a building city2tabula hasn't linked yet")
	assert.Len(t, result, 2, "after the run, both buildings should resolve, not just the one already linked from an earlier overlapping polygon")
	assert.Contains(t, result, "111")
	assert.Contains(t, result, "222")
}

// TestResolveEnvelope_FullCoverageSkipsRun asserts the fix doesn't lose the
// original optimization: when every building the topology needs is already
// linked, no run is triggered.
func TestResolveEnvelope_FullCoverageSkipsRun(t *testing.T) {
	client := fakeTentacronC2T(t, func(target string) (int, string) {
		if target != "c2t-buildings" {
			t.Fatalf("no run should be triggered when all needed buildings are already linked; got target %s", target)
		}
		return 200, `[{"object_id":"DE1","osm_id":"111","match_type":1}]`
	})
	log := logrus.NewEntry(logrus.New())
	bbox := city2tabula.Bbox{Xmin: 1, Ymin: 2, Xmax: 3, Ymax: 4}

	result := resolveEnvelope(context.Background(), log, client, nil, commonModels.Model{ID: 1}, "germany", bbox, topologyBuildings("111"))

	assert.Len(t, result, 1)
	assert.Contains(t, result, "111")
}

func TestBuildingOSMIDs_CollectsOnlyBasePOI(t *testing.T) {
	topology := []interface{}{
		map[string]interface{}{
			"from": map[string]interface{}{"properties": map[string]interface{}{"feature_type": "BasePOI", "osm_id": "111"}},
			"to":   map[string]interface{}{"properties": map[string]interface{}{"feature_type": "TopologyNode", "osm_id": "Trafo_1"}},
		},
		map[string]interface{}{
			"from": map[string]interface{}{"properties": map[string]interface{}{"feature_type": "BasePOI", "osm_id": "111"}}, // duplicate
		},
		map[string]interface{}{
			"from": map[string]interface{}{"properties": map[string]interface{}{"feature_type": "BasePOI", "osm_id": "222"}},
		},
	}

	ids := buildingOSMIDs(topology)
	assert.ElementsMatch(t, []string{"111", "222"}, ids)
}

func TestBuildingConstructionYear(t *testing.T) {
	if got := buildingConstructionYear(map[string]interface{}{"construction_year": float64(1975)}); got == nil || *got != 1975 {
		t.Errorf("float64 input: got %v, want 1975", got)
	}
	if got := buildingConstructionYear(map[string]interface{}{"construction_year": 1975}); got == nil || *got != 1975 {
		t.Errorf("int input: got %v, want 1975", got)
	}
	if got := buildingConstructionYear(map[string]interface{}{}); got != nil {
		t.Errorf("absent: got %v, want nil", got)
	}
	if got := buildingConstructionYear(map[string]interface{}{"construction_year": nil}); got != nil {
		t.Errorf("explicit nil: got %v, want nil", got)
	}
}

// fakeEnvelopeUValueResolver is a hand-rolled envelopeUValueResolver so
// attachEnvelopeUValues can be tested without a live ignis server.
type fakeEnvelopeUValueResolver struct {
	code       string
	matchErr   error
	uValues    ignis.EnvelopeUValues
	uValuesErr error
}

func (f fakeEnvelopeUValueResolver) ExistingStateVariant(ctx context.Context, iso2, buildingType string, year int) (string, error) {
	if f.matchErr != nil {
		return "", f.matchErr
	}
	return f.code, nil
}

func (f fakeEnvelopeUValueResolver) GetEnvelopeUValuesForLevel(ctx context.Context, existingStateCode string, level ignis.RefurbishmentLevel) (ignis.EnvelopeUValuesResult, error) {
	if f.uValuesErr != nil {
		return ignis.EnvelopeUValuesResult{}, f.uValuesErr
	}
	actual := level
	if actual == "" {
		actual = ignis.RefurbishmentExisting
	}
	return ignis.EnvelopeUValuesResult{EnvelopeUValues: f.uValues, Level: actual}, nil
}

func testYear(y int) *int { return &y }

func envelopeFixture() []city2tabula.EnvelopeElement {
	return []city2tabula.EnvelopeElement{
		{ID: "w1", Type: "wall", Area: city2tabula.Quantity{Value: 20, Unit: "m2"}},
		{ID: "r1", Type: "roof", Area: city2tabula.Quantity{Value: 15, Unit: "m2"}},
		{ID: "f1", Type: "floor", Area: city2tabula.Quantity{Value: 30, Unit: "m2"}},
	}
}

func TestAttachEnvelopeUValues_setsEffectiveUAndBTransmission(t *testing.T) {
	client := fakeEnvelopeUValueResolver{
		code: "DE.N.SFH.05.Gen",
		uValues: ignis.EnvelopeUValues{
			UWall: 1.2, URoof: 0.9, UFloor: 1.1,
			BTransWall: 1, BTransRoof: 1, BTransFloor: 0.5,
			Bridging: 0.1,
		},
	}

	got, meta := attachEnvelopeUValues(context.Background(), client, envelopeFixture(), "", "detached", "germany", testYear(1975), ignis.RefurbishmentExisting)

	require.Len(t, got, 3)
	u := map[string]float64{}
	bt := map[string]*city2tabula.Quantity{}
	for _, el := range got {
		require.NotNil(t, el.U, "%s should have U set", el.Type)
		u[el.Type] = el.U.Value
		bt[el.Type] = el.BTransmission
	}
	// effective U = U_Actual + bridging delta
	assert.InDelta(t, 1.3, u["wall"], 1e-9)
	assert.InDelta(t, 1.0, u["roof"], 1e-9)
	assert.InDelta(t, 1.2, u["floor"], 1e-9)
	// b_transmission set only where ignis gave a value below 1
	assert.Nil(t, bt["wall"])
	assert.Nil(t, bt["roof"])
	require.NotNil(t, bt["floor"])
	assert.Equal(t, 0.5, bt["floor"].Value)
	assert.Equal(t, "-", bt["floor"].Unit)
	assert.Equal(t, "DE.N.SFH.05.Gen", meta.VariantCode)
	assert.Equal(t, ignis.RefurbishmentExisting, meta.Level)
}

func TestAttachEnvelopeUValues_nilClientLeavesElementsUnchanged(t *testing.T) {
	got, meta := attachEnvelopeUValues(context.Background(), nil, envelopeFixture(), "", "detached", "germany", testYear(1975), ignis.RefurbishmentExisting)

	for _, el := range got {
		assert.Nil(t, el.U)
	}
	assert.Equal(t, BuemResolutionMeta{}, meta)
}

func TestAttachEnvelopeUValues_resolutionFailureLeavesElementsUnchanged(t *testing.T) {
	cases := []struct {
		name             string
		fClass           string
		country          string
		constructionYear *int
	}{
		{"non-residential", "office", "germany", testYear(1975)},
		{"no year", "detached", "germany", nil},
		{"no country", "detached", "", testYear(1975)},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			client := fakeEnvelopeUValueResolver{code: "DE.N.SFH.05.Gen", uValues: ignis.EnvelopeUValues{UWall: 1.2, URoof: 0.9, UFloor: 1.1}}
			got, _ := attachEnvelopeUValues(context.Background(), client, envelopeFixture(), "", tt.fClass, tt.country, tt.constructionYear, ignis.RefurbishmentExisting)
			for _, el := range got {
				assert.Nil(t, el.U, "%s should not carry a resolved U-value", tt.name)
			}
		})
	}
}

func TestAttachEnvelopeUValues_ignisFailureLeavesElementsUnchanged(t *testing.T) {
	client := fakeEnvelopeUValueResolver{matchErr: assert.AnError}
	got, meta := attachEnvelopeUValues(context.Background(), client, envelopeFixture(), "", "detached", "germany", testYear(1975), ignis.RefurbishmentExisting)
	for _, el := range got {
		assert.Nil(t, el.U)
	}
	assert.Equal(t, BuemResolutionMeta{}, meta)
}

func TestAttachEnvelopeUValues_unavailableLevelFallsBackToExisting(t *testing.T) {
	client := fakeEnvelopeUValueResolver{
		code:    "NL.N.AB.03.Gal.ReEx.001.001",
		uValues: ignis.EnvelopeUValues{UWall: 1.2, URoof: 0.9, UFloor: 1.1},
	}

	got, meta := attachEnvelopeUValues(context.Background(), client, envelopeFixture(), "", "detached", "netherlands", testYear(1975), ignis.RefurbishmentMedium)

	for _, el := range got {
		require.NotNil(t, el.U)
	}
	// the fake always succeeds and echoes back the level it was asked for -
	// this only asserts the level requested reaches ignis and comes back in
	// meta; GetEnvelopeUValuesForLevel's own fallback-on-404 behaviour is
	// covered in internal/ignis/client_test.go.
	assert.Equal(t, ignis.RefurbishmentMedium, meta.Level)
}

// A City2TABULA geometry-derived variant code is used directly: no year is
// supplied and the f-class is non-residential (both would fail the
// ResolveVariant fallback), yet U-values still land because the c2t code
// bypasses that path. matchErr would surface if ResolveVariant were called.
func TestAttachEnvelopeUValues_usesCity2TabulaVariantCodeWithoutYear(t *testing.T) {
	client := fakeEnvelopeUValueResolver{
		matchErr: assert.AnError,
		uValues:  ignis.EnvelopeUValues{UWall: 1.2, URoof: 0.9, UFloor: 1.1},
	}

	got, meta := attachEnvelopeUValues(context.Background(), client, envelopeFixture(), "NL.N.AB.01.Por1945.ReEx.001.001", "office", "netherlands", nil, ignis.RefurbishmentExisting)

	assert.Equal(t, "NL.N.AB.01.Por1945.ReEx.001.001", meta.VariantCode)
	byType := map[string]float64{}
	for _, el := range got {
		require.NotNil(t, el.U, "%s should have U set from the c2t variant code", el.Type)
		byType[el.Type] = el.U.Value
	}
	assert.Equal(t, 1.2, byType["wall"])
	assert.Equal(t, 0.9, byType["roof"])
	assert.Equal(t, 1.1, byType["floor"])
	// Bridging and b_transmission default to 0/nil here, so effective U == U_Actual.
}

// A service class from OSM overrides the TABULA type on the block: the
// building is still built from its City2TABULA envelope, but BuEM must
// model it with the service occupancy profile, not a household.
func TestBuildingsForBuem_serviceClassOverridesBuildingType(t *testing.T) {
	storeys := int32(2)
	code := "NL.N.SFH.05.Gen.ReEx.001.001"
	topology := []interface{}{map[string]interface{}{"from": map[string]interface{}{
		"geometry": map[string]interface{}{"type": "Point", "coordinates": []interface{}{6.0, 52.0}},
		"properties": map[string]interface{}{
			"feature_type": "BasePOI", "osm_id": "555", "f_class": "bakery", "capacity": float64(4),
		},
	}}}
	envelopeByOSMID := map[string]city2tabula.Building{"555": {
		OSMID: "555", NumberOfStoreys: &storeys, TabulaVariantCode: &code,
		Surfaces: []city2tabula.Surface{{ID: "w1", Type: "WallSurface", AreaSqm: floatPtr(20), Azimuth: floatPtr(90), Tilt: floatPtr(0)}},
	}}

	buildings, resolved, _ := buildingsForBuem(context.Background(), nil, "netherlands", topology, envelopeByOSMID, ignis.RefurbishmentExisting, cookingSettings{Carrier: CookingElectric, IncludeDHW: true})

	require.Len(t, buildings, 1)
	var block map[string]interface{}
	require.NoError(t, json.Unmarshal(buildings[0].Building, &block))
	assert.Equal(t, "bakery", block["building_type"])
	assert.Equal(t, float64(4), block["capacity"])
	assert.NotContains(t, block, "construction_period", "a TABULA period is residential classification, not sent for a service building")
	assert.Equal(t, float64(2), block["n_storeys"], "geometry from City2TABULA is still sent")
	assert.Equal(t, "bakery", resolved["555"].BuildingType)
}

// residential_units comes from the archetype's dwelling count: sent only
// above one, never for a service building, and 0 (unknown) is omitted.
func TestBuildingsForBuem_residentialUnitsFromArchetype(t *testing.T) {
	code := "NL.N.AB.03.Gal.ReEx.001.001"
	envelope := func(osmID string) city2tabula.Building {
		return city2tabula.Building{OSMID: osmID, TabulaVariantCode: &code,
			Surfaces: []city2tabula.Surface{{ID: "w1", Type: "WallSurface", AreaSqm: floatPtr(20), Azimuth: floatPtr(90), Tilt: floatPtr(0)}}}
	}
	node := func(osmID, fClass string) map[string]interface{} {
		return map[string]interface{}{"from": map[string]interface{}{
			"geometry":   map[string]interface{}{"type": "Point", "coordinates": []interface{}{6.0, 52.0}},
			"properties": map[string]interface{}{"feature_type": "BasePOI", "osm_id": osmID, "f_class": fClass},
		}}
	}
	block := func(buildings []buem.Building, osmID string) map[string]interface{} {
		for _, b := range buildings {
			if b.ID == osmID {
				var m map[string]interface{}
				require.NoError(t, json.Unmarshal(b.Building, &m))
				return m
			}
		}
		t.Fatalf("building %s not sent", osmID)
		return nil
	}
	cooking := cookingSettings{Carrier: CookingElectric, IncludeDHW: true}

	for _, tt := range []struct {
		name       string
		apartments int
		fClass     string
		want       interface{} // nil = omitted
	}{
		{"block of 15", 15, "apartments", float64(15)},
		{"single dwelling", 1, "detached", nil},
		{"unknown count", 0, "apartments", nil},
		{"service building ignores the count", 15, "bakery", nil},
	} {
		t.Run(tt.name, func(t *testing.T) {
			client := fakeEnvelopeUValueResolver{uValues: ignis.EnvelopeUValues{UWall: 1, URoof: 1, UFloor: 1, Apartments: tt.apartments}}
			buildings, resolved, _ := buildingsForBuem(context.Background(), client, "netherlands",
				[]interface{}{node("1", tt.fClass)}, map[string]city2tabula.Building{"1": envelope("1")}, ignis.RefurbishmentExisting, cooking)
			got := block(buildings, "1")
			if tt.want == nil {
				assert.NotContains(t, got, "residential_units")
				assert.Equal(t, 0, resolved["1"].ResidentialUnits)
			} else {
				assert.Equal(t, tt.want, got["residential_units"])
				assert.Equal(t, tt.apartments, resolved["1"].ResidentialUnits)
			}
		})
	}
}

// With a run recorded for the model (started when its polygon was created),
// run_buem waits for that run instead of triggering a second one.
func TestResolveEnvelope_RecordedRunIsPolledNotRetriggered(t *testing.T) {
	var buildingsCalls int32
	client := fakeTentacronC2T(t, func(target string) (int, string) {
		switch target {
		case "c2t-buildings":
			if atomic.AddInt32(&buildingsCalls, 1) == 1 {
				return 200, `[]`
			}
			return 200, `[{"object_id":"DE2","osm_id":"222","match_type":1}]`
		case "c2t-run-status":
			return 200, `{"run_id":"recorded-1","country":"germany","status":"completed"}`
		}
		t.Fatalf("unexpected target %s: a recorded run must not be retriggered", target)
		return 0, ""
	})
	runs := &fakeRunStore{rec: &models.ModelCity2TabulaRun{ModelID: 7, RunID: "recorded-1", Country: "germany", Status: "running"}}
	log := logrus.NewEntry(logrus.New())

	result := resolveEnvelope(context.Background(), log, client, runs, commonModels.Model{ID: 7}, "germany", city2tabula.Bbox{Xmin: 1, Ymin: 2, Xmax: 3, Ymax: 4}, topologyBuildings("222"))

	assert.Contains(t, result, "222")
	assert.Empty(t, runs.saved, "no new run recorded")
	assert.Equal(t, []string{"completed"}, runs.status, "the recorded run's final status is written back")
}

// Without a recorded run, the run run_buem triggers itself is recorded so a
// later request can poll it instead of starting another.
func TestResolveEnvelope_TriggeredRunIsRecorded(t *testing.T) {
	var buildingsCalls int32
	client := fakeTentacronC2T(t, func(target string) (int, string) {
		switch target {
		case "c2t-buildings":
			if atomic.AddInt32(&buildingsCalls, 1) == 1 {
				return 200, `[]`
			}
			return 200, `[{"object_id":"DE2","osm_id":"222","match_type":1}]`
		case "c2t-trigger-run":
			return 200, `{"run_id":"run-9","country":"germany","status":"pending"}`
		case "c2t-run-status":
			return 200, `{"run_id":"run-9","country":"germany","status":"completed"}`
		}
		t.Fatalf("unexpected target %s", target)
		return 0, ""
	})
	runs := &fakeRunStore{}
	log := logrus.NewEntry(logrus.New())

	result := resolveEnvelope(context.Background(), log, client, runs, commonModels.Model{ID: 7}, "germany", city2tabula.Bbox{Xmin: 1, Ymin: 2, Xmax: 3, Ymax: 4}, topologyBuildings("222"))

	assert.Contains(t, result, "222")
	assert.Equal(t, []string{"run-9"}, runs.saved)
}
