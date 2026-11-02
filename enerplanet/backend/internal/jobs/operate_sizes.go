package jobs

import (
	"fmt"
	"math"
	"sort"
	"strconv"
	"strings"
)

// operateSizeFields names, per technology, the constraints operate mode needs finite.
// PV arrays are sized from their surfaces, heat technologies by sizeHeatTechs and
// supply markets need no limit, so none is listed. Must match OPERATE_SIZE_FIELDS in
// the frontend's operateSizes.ts.
var operateSizeFields = map[string][]string{
	"battery_storage": {"cont_energy_cap_max", "cont_storage_cap_max"},
	"air_conditioner": {"cont_energy_cap_max"},
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
	_, ok := finiteNumber(v)
	return ok
}

// finiteNumber returns v as a number when it is a finite float, int or numeric string.
func finiteNumber(v interface{}) (float64, bool) {
	var f float64
	switch x := v.(type) {
	case float64:
		f = x
	case int:
		f = float64(x)
	case string:
		parsed, err := strconv.ParseFloat(x, 64)
		if err != nil {
			return 0, false
		}
		f = parsed
	default:
		return 0, false
	}
	return f, !math.IsInf(f, 0) && !math.IsNaN(f)
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
	return fmt.Errorf("operate mode needs a size for every technology; %s have none on %d of the model's buildings (%s%s); open the model to see them marked, set the sizes or switch to plan mode",
		strings.Join(techList, ", "), len(unsized), strings.Join(ids, ", "), more)
}

// heatShortfall is a building whose heat technologies deliver less than its peak heat demand.
type heatShortfall struct {
	OSMID            string
	PeakKW, OutputKW float64
}

// sizeHeatTechs gives each heat technology without a size its building's peak heat
// demand in the model period, divided by its efficiency when that is below 1, since the
// size limits input and output alike (SC-16). It fails when a building's heat
// technologies, user-sized ones included, deliver less than that peak.
func sizeHeatTechs(topology []interface{}) error {
	var short []heatShortfall
	for _, feature := range payloadBuildings(topology) {
		props, _ := feature["properties"].(map[string]interface{})
		techs, _ := feature["techs"].(map[string]interface{})
		series, _ := props["demand_series"].(map[string]interface{})
		heat, _ := series["heat"].([]float64)
		if !hasAnyTech(techs, heatTechs) || len(heat) == 0 {
			continue
		}
		peak := 0.0
		for _, v := range heat {
			peak = math.Max(peak, v)
		}
		output := 0.0
		for _, key := range heatTechs {
			tech, ok := techs[key].(map[string]interface{})
			if !ok {
				continue
			}
			share := math.Min(1, heatEfficiency(tech))
			size, ok := finiteNumber(tech["cont_energy_cap_max"])
			if !ok {
				size = math.Ceil(peak/share*10) / 10
				tech["cont_energy_cap_max"] = size
			}
			output += size * share
		}
		if output < peak-1e-6 {
			short = append(short, heatShortfall{OSMID: fmt.Sprint(props["osm_id"]), PeakKW: peak, OutputKW: output})
		}
	}
	return heatShortfallError(short)
}

// heatEfficiency is a heat technology's cont_energy_eff, or 1 when it is unset or not positive.
func heatEfficiency(tech map[string]interface{}) float64 {
	if eff, ok := finiteNumber(tech["cont_energy_eff"]); ok && eff > 0 {
		return eff
	}
	return 1
}

// heatShortfallError names the first buildings of short with their peak and output.
func heatShortfallError(short []heatShortfall) error {
	if len(short) == 0 {
		return nil
	}
	sort.Slice(short, func(i, j int) bool { return short[i].OSMID < short[j].OSMID })
	shown := short
	if len(shown) > heatShownMax {
		shown = shown[:heatShownMax]
	}
	parts := make([]string, 0, len(shown))
	for _, s := range shown {
		parts = append(parts, fmt.Sprintf("%s (peak %.1f kW, delivers %.1f kW)", s.OSMID, s.PeakKW, s.OutputKW))
	}
	more := ""
	if len(short) > len(shown) {
		more = fmt.Sprintf(" and %d more", len(short)-len(shown))
	}
	return fmt.Errorf("the heat technologies of %d buildings deliver less than their peak heat demand: %s%s; raise their sizes, or clear them to size them from the peak",
		len(short), strings.Join(parts, ", "), more)
}
