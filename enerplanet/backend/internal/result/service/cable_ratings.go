package resultservice

import (
	"encoding/json"
	"math"
	"strconv"
	"strings"
)

// lvNominalKV is the LV pipe's nominal voltage. The pylovo LV cables carried in
// the model config are rated against 0.4 kV.
const lvNominalKV = 0.4

// pylovoKabelMaxIA is the per-cable-type continuous current rating (max_i_a,
// amperes), embedded verbatim from the pylovo equipment catalogue so a MEME
// ingest needs no runtime dependency on the pylovo checkout.
//
// Source: dependencies/enerplanet-pylovo/raw_data/equipment_data.csv — rows with
// typ="Kabel", columns name -> max_i_a. The names are the pylovo cable-type
// identifiers the model config carries in
// lines.features[].properties.cable_type (NYY_4_16, NYY_4_70, NAYY_4_120, …).
// The legacy standardLineTypeINom table uses a different naming scheme and does
// NOT match these values.
var pylovoKabelMaxIA = map[string]float64{
	"NAYY_4_185": 313,
	"NYY_4_95":   280,
	"NAYY_4_150": 270,
	"NFA2X_4_95": 245,
	"NAYY_4_120": 242,
	"NYY_4_70":   232,
	"NAYY_4_95":  215,
	"NFA2X_4_70": 205,
	"NFA2X_4_50": 165,
	"NYY_4_35":   159,
	"NAYY_4_50":  142,
	"NYY_4_16":   103,
}

// cableSNomMVA converts a cable's continuous current rating to an apparent
// power rating at a nominal voltage:
//
//	s_nom = sqrt(3) * v_nom_kV * i_max_A / 1000 * numParallel   [MVA]
//
// ok is false for a cable type absent from the pylovo catalogue (never guess a
// rating for an unknown cable).
func cableSNomMVA(cableType string, vNomKV float64, numParallel float64) (float64, bool) {
	iMax, ok := pylovoKabelMaxIA[cableType]
	if !ok {
		return 0, false
	}
	return math.Sqrt(3) * vNomKV * iMax / 1000 * numParallel, true
}

// arcPipeAndGrid splits a Coati transmission arc name into its pipe token and
// the trailing grid number. The T1K topology names an arc
// <pipe>_<from.id>_<to.id>, e.g. "lv_1_trafo_82" -> pipe "lv", grid "82". ok is
// false when the name is not <pipe>_<…>_<number>.
func arcPipeAndGrid(arcName string) (pipe, grid string, ok bool) {
	parts := strings.Split(arcName, "_")
	if len(parts) < 2 {
		return "", "", false
	}
	grid = parts[len(parts)-1]
	if _, err := strconv.Atoi(grid); err != nil {
		return "", "", false
	}
	return parts[0], grid, true
}

// gridIDString renders a config grid_result_id (JSON number or string) as the
// decimal string the arc name's trailing token carries.
func gridIDString(v interface{}) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	case int:
		return strconv.Itoa(t)
	case int64:
		return strconv.FormatInt(t, 10)
	case json.Number:
		return t.String()
	}
	return ""
}

// wireRatingsByGrid resolves the conservative per-grid wire rating (MVA) from
// the model config's lines.features. The payload's LV arcs are a star (each
// building connects straight to its grid's transformer) and the `lines` features
// are never read when the topology is built, so a wire has no attributable
// single cable type; for each properties.grid_result_id it therefore takes the
// SMALLEST max_i_a among that grid's cables. v_nom is 0.4 kV and num_parallel 1
// (neither is carried per wire in the config).
//
// The result is keyed by grid_result_id — the trailing token of the arc name
// lv_<i>_trafo_<grid> (the <i> index is not known from the config, so the grid
// is the storable key; resolveWireRating derives it from the full arc name). A
// grid with no known cable and every MV arc simply have no entry.
func wireRatingsByGrid(config map[string]interface{}) map[string]float64 {
	lines, ok := config["lines"].(map[string]interface{})
	if !ok {
		return nil
	}
	features, ok := lines["features"].([]interface{})
	if !ok {
		return nil
	}

	minIMaxByGrid := map[string]float64{}
	minCableByGrid := map[string]string{}
	for _, f := range features {
		fMap, ok := f.(map[string]interface{})
		if !ok {
			continue
		}
		props, ok := fMap["properties"].(map[string]interface{})
		if !ok {
			continue
		}
		grid := gridIDString(props["grid_result_id"])
		cableType, _ := props["cable_type"].(string)
		iMax, known := pylovoKabelMaxIA[cableType]
		if grid == "" || !known {
			continue
		}
		if current, seen := minIMaxByGrid[grid]; !seen || iMax < current {
			minIMaxByGrid[grid] = iMax
			minCableByGrid[grid] = cableType
		}
	}

	ratings := make(map[string]float64, len(minCableByGrid))
	for grid, cableType := range minCableByGrid {
		if rating, ok := cableSNomMVA(cableType, lvNominalKV, 1); ok {
			ratings[grid] = rating
		}
	}
	if len(ratings) == 0 {
		return nil
	}
	return ratings
}

// resolveWireRating returns the real apparent-power rating (MVA) for a wire arc
// from the per-grid map. Only LV arcs qualify: the equipment catalogue carries
// no MV cable, so an MV arc — and any arc whose grid resolved no rating —
// returns ok=false and the caller omits loading_percent rather than fabricating
// one from the LP-optimised flow_cap.
func resolveWireRating(arcName string, gridRatings map[string]float64) (float64, bool) {
	pipe, grid, ok := arcPipeAndGrid(arcName)
	if !ok || pipe != "lv" {
		return 0, false
	}
	rating, found := gridRatings[grid]
	if !found || rating <= 0 {
		return 0, false
	}
	return rating, true
}
