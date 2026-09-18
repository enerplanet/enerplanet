package jobs

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"spatialhub_backend/internal/city2tabula"
	"spatialhub_backend/internal/ignis"
)

// editedWall is one wall as the configurator writes it back: a JSON-decoded
// property, so map[string]interface{} rather than the Go struct.
func editedWall(u float64) []interface{} {
	return []interface{}{map[string]interface{}{
		"id": "user-w1", "type": "wall",
		"area":    map[string]interface{}{"value": 40.0, "unit": "m2"},
		"azimuth": map[string]interface{}{"value": 180.0, "unit": "deg"},
		"tilt":    map[string]interface{}{"value": 90.0, "unit": "deg"},
		"U":       map[string]interface{}{"value": u, "unit": "W/(m2K)"},
	}}
}

func TestClientEnvelopeElements(t *testing.T) {
	for _, tt := range []struct {
		name  string
		props map[string]interface{}
		want  bool
	}{
		{"absent", map[string]interface{}{}, false},
		{"empty list is not an envelope", map[string]interface{}{clientEnvelopeProp: []interface{}{}}, false},
		{"wrong shape", map[string]interface{}{clientEnvelopeProp: "walls"}, false},
		{"one edited wall", map[string]interface{}{clientEnvelopeProp: editedWall(0.18)}, true},
	} {
		t.Run(tt.name, func(t *testing.T) {
			elements, ok := clientEnvelopeElements(tt.props)
			assert.Equal(t, tt.want, ok)
			if tt.want {
				require.Len(t, elements, 1)
				assert.Equal(t, "user-w1", elements[0].ID)
				require.NotNil(t, elements[0].U)
				assert.Equal(t, 0.18, elements[0].U.Value)
			}
		})
	}
}

// envelopeElementsOf runs one building through the job's resolution and returns
// the envelope elements that reached BuEM's building block.
func envelopeElementsOf(t *testing.T, props map[string]interface{}) []interface{} {
	t.Helper()
	code := "NL.N.SFH.03.Gen.ReEx.001.001"
	envelope := map[string]city2tabula.Building{"1": {OSMID: "1", TabulaVariantCode: &code,
		Surfaces: []city2tabula.Surface{{ID: "c2t-w1", Type: "WallSurface",
			AreaSqm: floatPtr(20), Azimuth: floatPtr(90), Tilt: floatPtr(0)}}}}

	p := map[string]interface{}{"feature_type": "BasePOI", "osm_id": "1", "f_class": "detached"}
	for k, v := range props {
		p[k] = v
	}
	node := map[string]interface{}{"from": map[string]interface{}{
		"geometry":   map[string]interface{}{"type": "Point", "coordinates": []interface{}{6.0, 52.0}},
		"properties": p,
	}}

	// The archetype would give every wall a U of 1.0, so a surviving 0.18 can
	// only have come from the caller.
	client := fakeEnvelopeUValueResolver{uValues: ignis.EnvelopeUValues{UWall: 1, URoof: 1, UFloor: 1}}
	buildings, _, _ := buildingsForBuem(context.Background(), client, "netherlands",
		[]interface{}{node}, envelope, ignis.RefurbishmentExisting,
		cookingSettings{Carrier: CookingElectric, IncludeDHW: true})
	require.Len(t, buildings, 1)

	var block map[string]interface{}
	require.NoError(t, json.Unmarshal(buildings[0].Building, &block))
	env, ok := block["envelope"].(map[string]interface{})
	require.True(t, ok)
	elements, ok := env["elements"].([]interface{})
	require.True(t, ok)
	return elements
}

func TestBuildingsForBuem_editedEnvelopeReplacesTheResolvedOne(t *testing.T) {
	elements := envelopeElementsOf(t, map[string]interface{}{clientEnvelopeProp: editedWall(0.18)})

	require.Len(t, elements, 1)
	el := elements[0].(map[string]interface{})
	assert.Equal(t, "user-w1", el["id"], "the user's surface, not City2TABULA's")
	assert.Equal(t, 0.18, el["U"].(map[string]interface{})["value"],
		"the archetype U-value must not overwrite what the user set")
	assert.Equal(t, 40.0, el["area"].(map[string]interface{})["value"])
}

func TestBuildingsForBuem_withoutAnEditTheResolvedEnvelopeStands(t *testing.T) {
	elements := envelopeElementsOf(t, nil)

	require.Len(t, elements, 1)
	el := elements[0].(map[string]interface{})
	assert.Equal(t, "c2t-w1", el["id"])
	assert.Equal(t, 1.0, el["U"].(map[string]interface{})["value"])
}

// runOSM resolves one node whose osm_id may or may not be in the City2TABULA
// envelope map, and reports whether it survived and why not.
func runOSM(t *testing.T, osmID string, props map[string]interface{}) (buildings int, reason string) {
	t.Helper()
	code := "NL.N.SFH.03.Gen.ReEx.001.001"
	envelope := map[string]city2tabula.Building{"linked": {OSMID: "linked", TabulaVariantCode: &code,
		Surfaces: []city2tabula.Surface{{ID: "c2t-w1", Type: "WallSurface",
			AreaSqm: floatPtr(20), Azimuth: floatPtr(90), Tilt: floatPtr(0)}}}}

	p := map[string]interface{}{"feature_type": "BasePOI", "osm_id": osmID, "f_class": "detached"}
	for k, v := range props {
		p[k] = v
	}
	node := map[string]interface{}{"from": map[string]interface{}{
		"geometry":   map[string]interface{}{"type": "Point", "coordinates": []interface{}{6.0, 52.0}},
		"properties": p,
	}}

	client := fakeEnvelopeUValueResolver{uValues: ignis.EnvelopeUValues{UWall: 1, URoof: 1, UFloor: 1}}
	got, _, unresolved := buildingsForBuem(context.Background(), client, "netherlands",
		[]interface{}{node}, envelope, ignis.RefurbishmentExisting,
		cookingSettings{Carrier: CookingElectric, IncludeDHW: true})
	return len(got), unresolved[osmID]
}

func TestBuildingsForBuem_unlinkedBuildingWithAnEditStillRuns(t *testing.T) {
	buildings, reason := runOSM(t, "unlinked", map[string]interface{}{clientEnvelopeProp: editedWall(0.18)})

	assert.Equal(t, 1, buildings, "an edited envelope is enough to run a building City2TABULA has not linked")
	assert.Empty(t, reason)
}

func TestBuildingsForBuem_unlinkedBuildingWithoutAnEditIsStillDropped(t *testing.T) {
	buildings, reason := runOSM(t, "unlinked", nil)

	assert.Equal(t, 0, buildings)
	assert.Equal(t, "no City2TABULA envelope for this building", reason)
}
