package jobs

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"spatialhub_backend/internal/buem"
	"spatialhub_backend/internal/city2tabula"
	"spatialhub_backend/internal/ignis"
)

// storedBuemNode is a topology node for a building edited in the
// configurator: its BuEM building block is stored under properties.buem.
func storedBuemNode(osmID string, block map[string]interface{}) map[string]interface{} {
	return map[string]interface{}{"from": map[string]interface{}{
		"geometry": map[string]interface{}{"type": "Point", "coordinates": []interface{}{6.0, 52.0}},
		"properties": map[string]interface{}{
			"feature_type": "BasePOI", "osm_id": osmID, "f_class": "apartments",
			"buem": map[string]interface{}{"building": block},
		},
	}}
}

func TestBuildingsForBuem_storedBlockNeedsNoEnvelope(t *testing.T) {
	block := map[string]interface{}{"building_type": "MFH", "envelope": map[string]interface{}{"elements": []interface{}{}}}
	topology := []interface{}{storedBuemNode("777", block)}

	buildings, resolved, unresolved := buildingsForBuem(context.Background(), nil, "germany", topology,
		map[string]city2tabula.Building{}, ignis.RefurbishmentExisting, cookingSettings{Carrier: CookingGas, IncludeDHW: true})

	require.Len(t, buildings, 1, "a stored block is BuEM input on its own; no City2TABULA envelope is needed")
	assert.JSONEq(t, `{"building_type":"MFH","envelope":{"elements":[]}}`, string(buildings[0].Building))
	assert.Equal(t, "MFH", resolved["777"].BuildingType)
	assert.NotContains(t, unresolved, "777")
}

func TestBuildingsForBuem_storedBlockWinsOverEnvelope(t *testing.T) {
	block := map[string]interface{}{"building_type": "MFH", "n_air_infiltration": 0.2}
	topology := []interface{}{storedBuemNode("777", block)}
	envelope := map[string]city2tabula.Building{"777": {
		OSMID:    "777",
		Surfaces: []city2tabula.Surface{{ID: "w1", Type: "WallSurface", AreaSqm: floatPtr(20), Azimuth: floatPtr(90), Tilt: floatPtr(0)}},
	}}

	buildings, _, _ := buildingsForBuem(context.Background(), nil, "germany", topology,
		envelope, ignis.RefurbishmentExisting, cookingSettings{Carrier: CookingGas, IncludeDHW: true})

	require.Len(t, buildings, 1)
	assert.JSONEq(t, `{"building_type":"MFH","n_air_infiltration":0.2}`, string(buildings[0].Building),
		"the user's edited block is sent verbatim, not rebuilt from City2TABULA")
}

func TestMergeBuemResults_keepsTheStoredBuildingBlock(t *testing.T) {
	block := map[string]interface{}{"building_type": "MFH"}
	topology := []interface{}{storedBuemNode("777", block)}

	mergeBuemResults(logrus.NewEntry(logrus.New()), topology,
		[]buem.BuildingResult{{ID: "777", BUEM: json.RawMessage(`{"thermal_load_profile":{"heating_kwh":1}}`)}})

	props := topology[0].(map[string]interface{})["from"].(map[string]interface{})["properties"].(map[string]interface{})
	stored := props["buem"].(map[string]interface{})
	assert.Equal(t, block, stored["building"], "the stored input survives a run")
	assert.Contains(t, stored, "thermal_load_profile", "the run result is added beside it")
}

func TestBuildingsForBuem_storedSolverTravelsBesideTheBlock(t *testing.T) {
	node := storedBuemNode("777", map[string]interface{}{"building_type": "MFH"})
	props := node["from"].(map[string]interface{})["properties"].(map[string]interface{})
	props["buem"].(map[string]interface{})["solver"] = map[string]interface{}{"use_milp": true}

	buildings, _, _ := buildingsForBuem(context.Background(), nil, "germany", []interface{}{node},
		map[string]city2tabula.Building{}, ignis.RefurbishmentExisting, cookingSettings{Carrier: CookingGas, IncludeDHW: true})

	require.Len(t, buildings, 1)
	assert.JSONEq(t, `{"use_milp":true}`, string(buildings[0].Solver))
}
