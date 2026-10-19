package jobs

import "fmt"

// dropFurtherWayHeat removes the heat demand and heating technologies of the
// topology's further ways (see buemRun.further). Their 3D building's heat is
// in its best way's BuEM series; the yearly heat fallback would count it again.
func dropFurtherWayHeat(topology []interface{}, further map[string]string) {
	if len(further) == 0 {
		return
	}
	for _, feature := range payloadBuildings(topology) {
		props, _ := feature["properties"].(map[string]interface{})
		if _, ok := further[fmt.Sprint(props["osm_id"])]; !ok {
			continue
		}
		props["demand_heat"] = 0
		if perClass, ok := props["f_class_heat_demands"].([]map[string]interface{}); ok {
			for _, d := range perClass {
				d["demand_heat_energy"] = 0
			}
		}
		if techs, ok := feature["techs"].(map[string]interface{}); ok {
			for _, key := range heatTechs {
				delete(techs, key)
			}
		}
	}
}
