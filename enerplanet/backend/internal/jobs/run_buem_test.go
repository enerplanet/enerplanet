package jobs

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"spatialhub_backend/internal/city2tabula"
)

func floatPtr(f float64) *float64 { return &f }
func boolPtr(b bool) *bool        { return &b }

func TestEnvelopeElements_MapsAndInvertsTilt(t *testing.T) {
	building := city2tabula.Building{
		Surfaces: []city2tabula.Surface{
			{ID: "w1", Type: "WallSurface", AreaSqm: floatPtr(30), Azimuth: floatPtr(180), Tilt: floatPtr(0)},
			{ID: "r1", Type: "RoofSurface", AreaSqm: floatPtr(50), Azimuth: floatPtr(-1), Tilt: floatPtr(90)},
		},
	}

	elements := envelopeElements(building)
	require.Len(t, elements, 2)

	wall := elements[0]
	assert.Equal(t, "wall", wall["type"])
	assert.Equal(t, 90.0, wall["tilt"].(map[string]interface{})["value"]) // City2TABULA 0=wall -> BuEM 90=wall
	assert.Equal(t, 180.0, wall["azimuth"].(map[string]interface{})["value"])

	roof := elements[1]
	assert.Equal(t, "roof", roof["type"])
	assert.Equal(t, 0.0, roof["tilt"].(map[string]interface{})["value"]) // City2TABULA 90=roof -> BuEM 0=roof
	assert.Equal(t, 0.0, roof["azimuth"].(map[string]interface{})["value"], "undefined azimuth (-1) must clamp to 0, not violate the [0,360] schema range")
}

func TestEnvelopeElements_SkipsUnmappedInvalidAndIncomplete(t *testing.T) {
	building := city2tabula.Building{
		Surfaces: []city2tabula.Surface{
			{ID: "closure", Type: "ClosureSurface", AreaSqm: floatPtr(10), Azimuth: floatPtr(0), Tilt: floatPtr(0)},
			{ID: "invalid", Type: "WallSurface", AreaSqm: floatPtr(10), Azimuth: floatPtr(0), Tilt: floatPtr(0), IsValid: boolPtr(false)},
			{ID: "nonplanar", Type: "WallSurface", AreaSqm: floatPtr(10), Azimuth: floatPtr(0), Tilt: floatPtr(0), IsPlanar: boolPtr(false)},
			{ID: "noarea", Type: "WallSurface", Azimuth: floatPtr(0), Tilt: floatPtr(0)},
			{ID: "ok", Type: "WallSurface", AreaSqm: floatPtr(10), Azimuth: floatPtr(0), Tilt: floatPtr(0), IsValid: boolPtr(true), IsPlanar: boolPtr(true)},
		},
	}

	elements := envelopeElements(building)
	require.Len(t, elements, 1)
	assert.Equal(t, "ok", elements[0]["id"])
}

func TestAttachBuemData_MatchesByOSMIDAndRequiresBoth(t *testing.T) {
	building := func(osmID string) map[string]interface{} {
		return map[string]interface{}{
			"properties": map[string]interface{}{
				"feature_type": "BasePOI",
				"osm_id":       osmID,
			},
		}
	}
	transformer := map[string]interface{}{
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
	weatherJSON := json.RawMessage(`{"index":[],"variables":{}}`)

	attachBuemData(topology, envelopeByOSMID, weatherJSON)

	matched := topology[0].(map[string]interface{})["from"].(map[string]interface{})
	props := matched["properties"].(map[string]interface{})
	require.Contains(t, props, "buem", "building 111 has both envelope and weather, should be enriched")

	trafoProps := topology[0].(map[string]interface{})["to"].(map[string]interface{})["properties"].(map[string]interface{})
	assert.NotContains(t, trafoProps, "buem", "transformer nodes are never BasePOI, must never get a buem block")

	unmatched := topology[1].(map[string]interface{})["from"].(map[string]interface{})
	unmatchedProps := unmatched["properties"].(map[string]interface{})
	assert.NotContains(t, unmatchedProps, "buem", "building 222 has no envelope match, must be left alone")
}

func TestAttachBuemData_NoWeatherAttachesNothing(t *testing.T) {
	topology := []interface{}{
		map[string]interface{}{
			"from": map[string]interface{}{
				"properties": map[string]interface{}{"feature_type": "BasePOI", "osm_id": "111"},
			},
		},
	}
	envelopeByOSMID := map[string]city2tabula.Building{
		"111": {OSMID: "111", Surfaces: []city2tabula.Surface{
			{ID: "w1", Type: "WallSurface", AreaSqm: floatPtr(20), Azimuth: floatPtr(90), Tilt: floatPtr(0)},
		}},
	}

	attachBuemData(topology, envelopeByOSMID, nil)

	props := topology[0].(map[string]interface{})["from"].(map[string]interface{})["properties"].(map[string]interface{})
	assert.NotContains(t, props, "buem", "buem-gateway requires both envelope and weather; must not send envelope alone")
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
