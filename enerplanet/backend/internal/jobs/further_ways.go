package jobs

import "fmt"

// dropFurtherWayDemand removes from each further way (see buemRun.further) the
// demand its standing way's BuEM series already covers for the whole 3D
// building: heat with the heating technologies, and electricity. A carrier
// the standing way has no series for stays, since nothing else models it.
// Run after attachDemandSeries, which sets the series it reads. It returns
// the ways whose electricity it dropped: their demand is covered, not missing.
func dropFurtherWayDemand(topology []interface{}, further map[string]string) map[string]bool {
	covered := map[string]bool{}
	if len(further) == 0 {
		return covered
	}
	series := map[string]map[string]interface{}{}
	for _, feature := range payloadBuildings(topology) {
		props, _ := feature["properties"].(map[string]interface{})
		s, _ := props["demand_series"].(map[string]interface{})
		series[fmt.Sprint(props["osm_id"])] = s
	}
	for _, feature := range payloadBuildings(topology) {
		props, _ := feature["properties"].(map[string]interface{})
		osmID := fmt.Sprint(props["osm_id"])
		standing, ok := further[osmID]
		if !ok {
			continue
		}
		if _, ok := series[standing]["heat"]; ok {
			dropCarrier(props, "demand_heat", "f_class_heat_demands", "demand_heat_energy")
			if techs, ok := feature["techs"].(map[string]interface{}); ok {
				for _, key := range heatTechs {
					delete(techs, key)
				}
			}
		}
		if _, ok := series[standing]["electricity"]; ok {
			dropCarrier(props, "demand_energy", "f_class_demands", "demand_energy")
			covered[osmID] = true
		}
	}
	return covered
}

// dropCarrier zeroes a building's yearly demand and its per-class shares.
func dropCarrier(props map[string]interface{}, total, perClassKey, perClassField string) {
	props[total] = 0
	if perClass, ok := props[perClassKey].([]map[string]interface{}); ok {
		for _, d := range perClass {
			d[perClassField] = 0
		}
	}
}
