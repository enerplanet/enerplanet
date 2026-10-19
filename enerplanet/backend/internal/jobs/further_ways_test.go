package jobs

import (
	"context"
	"testing"

	"spatialhub_backend/internal/city2tabula"
)

// building returns a payload building feature with a gas boiler and a PV system.
func building(osmID string) map[string]interface{} {
	return map[string]interface{}{
		"properties": map[string]interface{}{
			"feature_type":         "BasePOI",
			"osm_id":               osmID,
			"demand_energy":        4000,
			"demand_heat":          30000,
			"f_class_heat_demands": []map[string]interface{}{{"f_class": "hospital", "demand_heat_energy": 30000}},
		},
		"techs": map[string]interface{}{"gas_boiler": map[string]interface{}{}, "pv_supply": map[string]interface{}{}},
	}
}

// Mainkofen: 223728275 is the best way of DEBY_LOD2_7595822, 1265475272 a further way.
var mainkofenFurther = map[string]string{"1265475272": "223728275"}

// standing returns building osmID with BuEM series for the given carriers.
func standing(osmID string, carriers ...string) map[string]interface{} {
	b := building(osmID)
	series := map[string]interface{}{}
	for _, c := range carriers {
		series[c] = []float64{1}
	}
	b["properties"].(map[string]interface{})["demand_series"] = series
	return b
}

// A further way loses the demand its standing way's BuEM series covers for the
// whole building, and keeps its other technologies.
func TestDropFurtherWayDemand(t *testing.T) {
	best, further := standing("223728275", "heat", "electricity"), building("1265475272")
	dropFurtherWayDemand([]interface{}{map[string]interface{}{"from": best, "to": further}}, mainkofenFurther)

	fp := further["properties"].(map[string]interface{})
	if fp["demand_heat"] != 0 || fp["f_class_heat_demands"].([]map[string]interface{})[0]["demand_heat_energy"] != 0 {
		t.Errorf("further way heat = %v / %v, want 0", fp["demand_heat"], fp["f_class_heat_demands"])
	}
	if fp["demand_energy"] != 0 {
		t.Errorf("further way electricity = %v, want 0", fp["demand_energy"])
	}
	ft := further["techs"].(map[string]interface{})
	if _, ok := ft["gas_boiler"]; ok {
		t.Error("further way kept its gas boiler")
	}
	if _, ok := ft["pv_supply"]; !ok {
		t.Error("further way lost its PV system")
	}
	if bp := best["properties"].(map[string]interface{}); bp["demand_heat"] != 30000 || bp["demand_energy"] != 4000 {
		t.Errorf("best way demand = %v / %v, want kept", bp["demand_heat"], bp["demand_energy"])
	}
}

// Without a series on the standing way nothing covers the whole building, so
// the further way keeps that carrier's demand.
func TestDropFurtherWayDemand_keepsWhatTheStandingWayLacks(t *testing.T) {
	for name, tc := range map[string]struct {
		best                map[string]interface{} // nil: the best way is not in the model
		wantHeat, wantPower interface{}
	}{
		"electricity only": {best: standing("223728275", "electricity"), wantHeat: 30000, wantPower: 0},
		"no series":        {best: building("223728275"), wantHeat: 30000, wantPower: 4000},
		"best way absent":  {best: nil, wantHeat: 30000, wantPower: 4000},
	} {
		further := building("1265475272")
		topology := []interface{}{map[string]interface{}{"from": further, "to": further}}
		if tc.best != nil {
			topology = append(topology, map[string]interface{}{"from": tc.best, "to": tc.best})
		}
		dropFurtherWayDemand(topology, mainkofenFurther)
		fp := further["properties"].(map[string]interface{})
		if fp["demand_heat"] != tc.wantHeat || fp["demand_energy"] != tc.wantPower {
			t.Errorf("%s: heat %v power %v, want %v %v", name, fp["demand_heat"], fp["demand_energy"], tc.wantHeat, tc.wantPower)
		}
	}
}

// A further way is linked, so it neither counts as missing (which would start a
// City2TABULA run) nor goes to BuEM, which runs the building under its best way.
func TestFurtherWayIsLinkedButNotSentToBuem(t *testing.T) {
	if missing := missingOSMIDs([]string{"223728275", "1265475272", "999"}, map[string]city2tabula.Building{"223728275": {}}, mainkofenFurther); len(missing) != 1 || missing[0] != "999" {
		t.Errorf("missing = %v, want only 999", missing)
	}

	topology := []interface{}{map[string]interface{}{"from": building("1265475272"), "to": building("1265475272")}}
	buildings, _, unresolved := buildingsForBuem(context.Background(), nil, "germany", topology, nil, mainkofenFurther, "", cookingSettings{})
	if _, failed := unresolved["1265475272"]; len(buildings) != 0 || failed {
		t.Errorf("buildings %d, unresolved %v; want the further way neither sent nor failed", len(buildings), unresolved)
	}
}

// A covered further way's demand is carried by its standing way, so the
// coverage warning neither counts it as running on yearly demand nor in the total.
func TestCoverageLeavesOutCoveredWays(t *testing.T) {
	best, further := standing("223728275", "electricity"), building("1265475272")
	topology := []interface{}{map[string]interface{}{"from": best, "to": further}}
	covered := dropFurtherWayDemand(topology, mainkofenFurther)

	if !covered["1265475272"] {
		t.Fatalf("covered = %v, want the further way", covered)
	}
	if w, err := checkDemandCoverage(topology, covered); err != nil || w != nil {
		t.Errorf("warning %+v, err %v; want none", w, err)
	}
}
