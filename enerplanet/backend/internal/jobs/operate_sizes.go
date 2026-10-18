package jobs

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

// operateSizeFields names, per technology, the constraints operate mode needs finite.
// PV arrays are sized from their surfaces and supply markets need no limit, so neither
// is listed. Must match OPERATE_SIZE_FIELDS in the frontend's operateSizes.ts.
var operateSizeFields = map[string][]string{
	"battery_storage":         {"cont_energy_cap_max", "cont_storage_cap_max"},
	"air_source_heat_pump":    {"cont_energy_cap_max"},
	"ground_source_heat_pump": {"cont_energy_cap_max"},
	"electric_boilers":        {"cont_energy_cap_max"},
	"gas_boiler":              {"cont_energy_cap_max"},
	"air_conditioner":         {"cont_energy_cap_max"},
}

// unsizedBuilding is a building with technologies an operate run cannot fix.
type unsizedBuilding struct {
	OSMID string
	Techs map[string][]string // technology key to its missing size fields
}

// unsizedBuildings lists the payload's buildings whose technologies lack a finite size.
func unsizedBuildings(topology []interface{}) []unsizedBuilding {
	var out []unsizedBuilding
	for _, feature := range payloadBuildings(topology) {
		techs, _ := feature["techs"].(map[string]interface{})
		missing := map[string][]string{}
		for key, raw := range techs {
			tech, _ := raw.(map[string]interface{})
			for _, field := range operateSizeFields[key] {
				if !isFinite(tech[field]) {
					missing[key] = append(missing[key], field)
				}
			}
		}
		if len(missing) > 0 {
			props, _ := feature["properties"].(map[string]interface{})
			out = append(out, unsizedBuilding{OSMID: fmt.Sprint(props["osm_id"]), Techs: missing})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].OSMID < out[j].OSMID })
	return out
}

func isFinite(v interface{}) bool {
	var f float64
	switch x := v.(type) {
	case float64:
		f = x
	case int:
		f = float64(x)
	case string:
		parsed, err := strconv.ParseFloat(x, 64)
		if err != nil {
			return false
		}
		f = parsed
	default:
		return false
	}
	return !math.IsInf(f, 0) && !math.IsNaN(f)
}

// checkOperateSizes fails an operate run whose buildings have unsized technologies,
// naming the technologies and the first buildings.
func checkOperateSizes(topology []interface{}) error {
	unsized := unsizedBuildings(topology)
	if len(unsized) == 0 {
		return nil
	}
	techSet := map[string]bool{}
	ids := make([]string, 0, len(unsized))
	for _, b := range unsized {
		ids = append(ids, b.OSMID)
		for key := range b.Techs {
			techSet[key] = true
		}
	}
	techList := make([]string, 0, len(techSet))
	for key := range techSet {
		techList = append(techList, key)
	}
	sort.Strings(techList)
	const shown = 10
	more := ""
	if len(ids) > shown {
		more = fmt.Sprintf(" and %d more", len(ids)-shown)
		ids = ids[:shown]
	}
	return fmt.Errorf("operate mode needs a size for every technology: %d buildings have %s without one (buildings %s%s); open the model to see them marked, set the sizes or switch to plan mode",
		len(unsized), strings.Join(techList, ", "), strings.Join(ids, ", "), more)
}
