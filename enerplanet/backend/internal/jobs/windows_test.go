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

func TestBuildingWindowSettings(t *testing.T) {
	u := func(v float64) map[string]interface{} { return map[string]interface{}{"value": v, "unit": "W/(m2K)"} }
	for _, tt := range []struct {
		name  string
		props map[string]interface{}
		want  map[string]interface{}
	}{
		{"nothing set", map[string]interface{}{}, map[string]interface{}{}},
		{"all four", map[string]interface{}{"window_to_wall_ratio": 0.3, "window_U": 1.1, "window_g_gl": 0.6, "door_U": 2.0},
			map[string]interface{}{"window_to_wall_ratio": 0.3, "window_U": u(1.1), "window_g_gl": 0.6, "door_U": u(2.0)}},
		{"int from Go code", map[string]interface{}{"door_U": 3}, map[string]interface{}{"door_U": u(3)}},
		{"ratio of 1 is out of range", map[string]interface{}{"window_to_wall_ratio": 1.0}, map[string]interface{}{}},
		{"zero ratio is allowed", map[string]interface{}{"window_to_wall_ratio": 0.0}, map[string]interface{}{"window_to_wall_ratio": 0.0}},
		{"non-positive U is dropped", map[string]interface{}{"window_U": 0.0, "door_U": -1.0}, map[string]interface{}{}},
		{"g_gl above 1 is dropped", map[string]interface{}{"window_g_gl": 1.5}, map[string]interface{}{}},
		{"strings are ignored", map[string]interface{}{"window_U": "1.1"}, map[string]interface{}{}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, buildingWindowSettings(tt.props))
		})
	}
}

func TestBuildingsForBuem_windowSettingsReachTheBlock(t *testing.T) {
	code := "NL.N.SFH.03.Gen.ReEx.001.001"
	envelope := map[string]city2tabula.Building{"1": {OSMID: "1", TabulaVariantCode: &code,
		Surfaces: []city2tabula.Surface{{ID: "w1", Type: "WallSurface", AreaSqm: floatPtr(20), Azimuth: floatPtr(90), Tilt: floatPtr(0)}}}}
	node := map[string]interface{}{"from": map[string]interface{}{
		"geometry": map[string]interface{}{"type": "Point", "coordinates": []interface{}{6.0, 52.0}},
		"properties": map[string]interface{}{"feature_type": "BasePOI", "osm_id": "1", "f_class": "detached",
			"window_to_wall_ratio": 0.25, "window_U": 1.3},
	}}
	client := fakeEnvelopeUValueResolver{uValues: ignis.EnvelopeUValues{UWall: 1, URoof: 1, UFloor: 1}}
	buildings, _, _ := buildingsForBuem(context.Background(), client, "netherlands",
		[]interface{}{node}, envelope, ignis.RefurbishmentExisting, cookingSettings{Carrier: CookingElectric, IncludeDHW: true})
	require.Len(t, buildings, 1)
	var block map[string]interface{}
	require.NoError(t, json.Unmarshal(buildings[0].Building, &block))
	assert.Equal(t, 0.25, block["window_to_wall_ratio"])
	assert.Equal(t, map[string]interface{}{"value": 1.3, "unit": "W/(m2K)"}, block["window_U"])
	assert.NotContains(t, block, "door_U")
}

func TestArchetypeGlazing_omitsWhatIgnisDidNotReport(t *testing.T) {
	u := func(v float64) map[string]interface{} { return map[string]interface{}{"value": v, "unit": "W/(m2K)"} }
	assert.Equal(t, map[string]interface{}{"window_U": u(2.8), "door_U": u(3.0), "window_g_gl": 0.75},
		archetypeGlazing(BuemResolutionMeta{WindowU: 2.8, DoorU: 3.0, WindowGGl: 0.75}))
	assert.Equal(t, map[string]interface{}{}, archetypeGlazing(BuemResolutionMeta{}))
	assert.Equal(t, map[string]interface{}{"window_U": u(1.1)},
		archetypeGlazing(BuemResolutionMeta{WindowU: 1.1, WindowGGl: 1.4}))
}

func TestBuildingsForBuem_archetypeGlazingSentAndUserValueWins(t *testing.T) {
	code := "NL.N.SFH.03.Gen.ReEx.001.001"
	envelope := map[string]city2tabula.Building{"1": {OSMID: "1", TabulaVariantCode: &code,
		Surfaces: []city2tabula.Surface{{ID: "w1", Type: "WallSurface", AreaSqm: floatPtr(20), Azimuth: floatPtr(90), Tilt: floatPtr(0)}}}}
	node := func(props map[string]interface{}) map[string]interface{} {
		p := map[string]interface{}{"feature_type": "BasePOI", "osm_id": "1", "f_class": "detached"}
		for k, v := range props {
			p[k] = v
		}
		return map[string]interface{}{"from": map[string]interface{}{
			"geometry": map[string]interface{}{"type": "Point", "coordinates": []interface{}{6.0, 52.0}}, "properties": p}}
	}
	send := func(props map[string]interface{}) map[string]interface{} {
		client := fakeEnvelopeUValueResolver{uValues: ignis.EnvelopeUValues{
			UWall: 1, URoof: 1, UFloor: 1, UWindow: 2.8, UDoor: 3.0, GGlWindow: 0.75}}
		buildings, _, _ := buildingsForBuem(context.Background(), client, "netherlands",
			[]interface{}{node(props)}, envelope, ignis.RefurbishmentExisting,
			cookingSettings{Carrier: CookingElectric, IncludeDHW: true})
		require.Len(t, buildings, 1)
		var block map[string]interface{}
		require.NoError(t, json.Unmarshal(buildings[0].Building, &block))
		return block
	}

	fromArchetype := send(nil)
	assert.Equal(t, map[string]interface{}{"value": 2.8, "unit": "W/(m2K)"}, fromArchetype["window_U"])
	assert.Equal(t, map[string]interface{}{"value": 3.0, "unit": "W/(m2K)"}, fromArchetype["door_U"])
	assert.Equal(t, 0.75, fromArchetype["window_g_gl"])

	userWins := send(map[string]interface{}{"window_U": 0.9})
	assert.Equal(t, map[string]interface{}{"value": 0.9, "unit": "W/(m2K)"}, userWins["window_U"],
		"a user-set window U overrides the archetype")
	assert.Equal(t, map[string]interface{}{"value": 3.0, "unit": "W/(m2K)"}, userWins["door_U"],
		"an untouched opening keeps the archetype value")
}
