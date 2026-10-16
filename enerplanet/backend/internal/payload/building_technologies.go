package payload

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
)

// buildingTechnologiesJSON holds the parameters a building's heat, cooling and
// gas technologies take when the saved technology lacks them, in payload units
// (kW, EUR/kW, EUR/kWh, years); each entry's "_source" names where they come from.
//
//go:embed building_technologies.json
var buildingTechnologiesJSON []byte

var buildingTechnologies = mustParseBuildingTechnologies(buildingTechnologiesJSON)

// mustParseBuildingTechnologies decodes the embedded defaults; a broken file stops the program at start.
func mustParseBuildingTechnologies(data []byte) map[string]map[string]interface{} {
	var out map[string]map[string]interface{}
	if err := json.Unmarshal(data, &out); err != nil {
		panic(fmt.Sprintf("payload: building_technologies.json is invalid: %v", err))
	}
	return out
}

// DefaultTechnology returns a copy of the default parameters of the named
// technology, or nil when it has none.
func DefaultTechnology(name string) map[string]interface{} {
	defaults, ok := buildingTechnologies[name]
	if !ok {
		return nil
	}
	out := make(map[string]interface{}, len(defaults))
	for k, v := range defaults {
		if !isNote(k) {
			out[k] = v
		}
	}
	return out
}

// fillTechnologyDefaults adds the default parameters each technology in
// techs is missing; a parameter already set is kept.
func fillTechnologyDefaults(techs map[string]interface{}) {
	for name, tech := range techs {
		params, ok := tech.(map[string]interface{})
		if !ok {
			continue
		}
		for k, v := range buildingTechnologies[name] {
			if _, set := params[k]; !set && !isNote(k) {
				params[k] = v
			}
		}
	}
}

// isNote reports whether key is documentation in building_technologies.json
// rather than a parameter.
func isNote(key string) bool {
	return strings.HasPrefix(key, "_")
}
