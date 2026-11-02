package jobs

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"spatialhub_backend/internal/city2tabula"
)

func lod2(useType string, height, footprint float64) city2tabula.Building {
	b := city2tabula.Building{ObjectID: "o", MaxHeight: &height, FootprintAreaSqm: &footprint}
	if useType != "" {
		b.UseType = &useType
	}
	return b
}

func TestResolveBuildingUse(t *testing.T) {
	tests := []struct {
		name       string
		props      map[string]interface{}
		buildings  []city2tabula.Building
		lookupDone bool
		want       buildingUse
	}{
		{"3D residential", map[string]interface{}{"f_class": "yes"}, []city2tabula.Building{lod2("residential", 8.5, 120)}, true,
			buildingUse{useType: "residential", source: useSource3D, heated: true}},
		{"3D ancillary garage", map[string]interface{}{"f_class": "yes"}, []city2tabula.Building{lod2("ancillary", 3, 18)}, true,
			buildingUse{useType: "ancillary", source: useSource3D, reason: reasonAncillary}},
		{"small hay barn", nil, []city2tabula.Building{lod2("agriculture", 3.8, 35)}, true,
			buildingUse{useType: "agriculture", source: useSource3D, reason: reasonSmall}},
		{"large workshop", nil, []city2tabula.Building{lod2("industry", 4.5, 120)}, true,
			buildingUse{useType: "industry", source: useSource3D, heated: true}},
		{"3D other falls back to OSM", map[string]interface{}{"f_class": "church"}, []city2tabula.Building{lod2("other", 12, 300)}, true,
			buildingUse{useType: "church", source: useSourceOSM, heated: true}},
		{"OSM ancillary", map[string]interface{}{"f_class": "garages"}, []city2tabula.Building{lod2("", 3, 60)}, true,
			buildingUse{useType: "garages", source: useSourceOSM, reason: reasonAncillary}},
		{"unknown and small", map[string]interface{}{"f_class": "yes"}, []city2tabula.Building{lod2("", 4.2, 30)}, true,
			buildingUse{reason: reasonSmall}},
		{"unknown, low but large", map[string]interface{}{"f_class": "yes"}, []city2tabula.Building{lod2("", 4.2, 80)}, true,
			buildingUse{heated: true}},
		{"unknown without measurements", nil, []city2tabula.Building{{ObjectID: "o"}}, true,
			buildingUse{heated: true}},
		{"user type wins over 3D", map[string]interface{}{"selected_f_class": "workshop"}, []city2tabula.Building{lod2("ancillary", 3, 18)}, true,
			buildingUse{useType: "workshop", source: useSourceUser, heated: true}},
		{"no 3D data after a completed lookup", map[string]interface{}{"f_class": "house"}, nil, true,
			buildingUse{useType: "house", source: useSourceOSM, reason: reasonNo3D}},
		{"no 3D data after an incomplete lookup", map[string]interface{}{"f_class": "house"}, nil, false,
			buildingUse{useType: "house", source: useSourceOSM, heated: true}},
		{"stored block stays heated", map[string]interface{}{"buem": map[string]interface{}{"building": map[string]interface{}{"building_type": "SFH"}}}, nil, true,
			buildingUse{heated: true}},
		{"largest 3D building decides", nil, []city2tabula.Building{lod2("residential", 9, 140), lod2("ancillary", 3, 20)}, true,
			buildingUse{useType: "residential", source: useSource3D, heated: true}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			assert.Equal(t, tt.want, resolveBuildingUse(tt.props, tt.buildings, tt.lookupDone))
		})
	}
}

// A garage given a gas boiler before the analysis finished loses its heat
// technology and heat demand, keeps its PV, and no longer refuses the run.
func TestDropUnheatedHeat(t *testing.T) {
	house, garage := standing("1", "heat", "electricity"), building("2")
	topology := []interface{}{map[string]interface{}{"from": house, "to": garage}}
	assert.Error(t, checkHeatCoverage(topology, nil), "before: the garage refuses the run")

	assert.Equal(t, 1, dropUnheatedHeat(topology, map[string]bool{"2": true}))

	assert.NoError(t, checkHeatCoverage(topology, nil))
	gt := garage["techs"].(map[string]interface{})
	assert.NotContains(t, gt, "gas_boiler")
	assert.Contains(t, gt, "pv_supply")
	assert.Equal(t, 0, garage["properties"].(map[string]interface{})["demand_heat"])
	assert.Contains(t, house["techs"].(map[string]interface{}), "gas_boiler")
}
