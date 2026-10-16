package jobs

import (
	"fmt"
	"math"
	"time"

	commonModels "platform.local/common/pkg/models"

	"spatialhub_backend/internal/payload"
	"spatialhub_backend/internal/store/series"
)

// Technologies that consume a building's heat, cooling or gas demand. A
// demand is sent only where one of them can meet it; otherwise the whole
// demand would be unmet at the model's penalty price.
var (
	heatTechs    = []string{"air_source_heat_pump", "ground_source_heat_pump", "electric_boilers", "gas_boiler"}
	coolingTechs = []string{"air_conditioner"}
	gasTechs     = []string{"gas_boiler"}
)

// seriesWindow is the part of a stored series a model run covers: steps
// values from offset, counted from 1 January 00:00 of the model's year.
type seriesWindow struct {
	offset, steps, resolution int
}

// modelSeriesWindow returns the window from a model's first to its last
// day, both included, at its resolution in minutes.
func modelSeriesWindow(from, to time.Time, resolution int) seriesWindow {
	perDay := 24 * 60 / resolution
	days := int(to.Sub(from).Hours()/24) + 1
	offset := (from.YearDay()-1)*perDay + from.Hour()*60/resolution
	return seriesWindow{offset: offset, steps: days * perDay, resolution: resolution}
}

// demandSeriesReader reads the series linked to a model; *series.Store
// implements it.
type demandSeriesReader interface {
	LinkedSeries(owner series.Owner, buildingRef string) ([]series.LinkedSeries, error)
}

// attachModelDemandSeries adds the BuEM series stored for model to the
// buildings of its calculation payload (see attachDemandSeries). A payload
// without a topology has no buildings to attach to.
func attachModelDemandSeries(reader demandSeriesReader, model *commonModels.Model, built interface{}) error {
	calc, ok := built.(payload.CalculationPayload)
	if !ok || len(calc.Topology) == 0 {
		return nil
	}
	linked, err := reader.LinkedSeries(series.Owner{ModelID: model.ID}, "")
	if err != nil {
		return fmt.Errorf("read stored demand series of model %d: %w", model.ID, err)
	}
	attachDemandSeries(calc.Topology, linked, modelSeriesWindow(model.FromDate, model.ToDate, calc.Resolution))
	return nil
}

// attachDemandSeries sets properties.demand_series on each building of
// topology that has stored series, keyed by carrier, in kW per model step.
// A building whose gas is used gets a gas_supply when it has none.
func attachDemandSeries(topology []interface{}, linked []series.LinkedSeries, w seriesWindow) {
	stored := groupBuildingSeries(linked, w.resolution)
	for _, feature := range payloadBuildings(topology) {
		props, _ := feature["properties"].(map[string]interface{})
		building, ok := stored[fmt.Sprint(props["osm_id"])]
		if !ok {
			continue
		}
		techs, _ := feature["techs"].(map[string]interface{})
		demand := carrierDemand(building, techs, w)
		if len(demand) == 0 {
			continue
		}
		props["demand_series"] = demand
		if _, cooking := demand["natural_gas"]; cooking || hasAnyTech(techs, gasTechs) {
			ensureGasSupply(feature)
		}
	}
}

// groupBuildingSeries indexes whole-building series at resolution by
// building and series name; roof-face series and other resolutions are left out.
func groupBuildingSeries(linked []series.LinkedSeries, resolution int) map[string]map[string][]float32 {
	out := map[string]map[string][]float32{}
	for _, l := range linked {
		if l.Part != "" || l.ResolutionMinutes != resolution || len(l.Vals) == 0 {
			continue
		}
		if out[l.BuildingRef] == nil {
			out[l.BuildingRef] = map[string][]float32{}
		}
		out[l.BuildingRef][l.Series] = l.Vals
	}
	return out
}

// payloadBuildings returns the building features of topology once each;
// transformers (TopologyNode) are left out.
func payloadBuildings(topology []interface{}) []map[string]interface{} {
	var out []map[string]interface{}
	seen := map[string]bool{}
	for _, entry := range topology {
		conn, _ := entry.(map[string]interface{})
		for _, side := range []string{"from", "to"} {
			feature, _ := conn[side].(map[string]interface{})
			props, _ := feature["properties"].(map[string]interface{})
			id := fmt.Sprint(props["osm_id"])
			if props == nil || props["feature_type"] == "TopologyNode" || seen[id] {
				continue
			}
			seen[id] = true
			out = append(out, feature)
		}
	}
	return out
}

// carrierDemand maps a building's BuEM series to the demand per carrier:
// heat is space heating plus hot water, cooling is made positive (BuEM
// reports it as negative), and the kitchen series is gas for cooking.
func carrierDemand(stored map[string][]float32, techs map[string]interface{}, w seriesWindow) map[string]interface{} {
	out := map[string]interface{}{}
	if v := stored["electricity"]; len(v) > 0 {
		out["electricity"] = window(v, w)
	}
	if heat := sumSeries(stored["heating"], stored["hot_water"]); len(heat) > 0 && hasAnyTech(techs, heatTechs) {
		out["heat"] = window(heat, w)
	}
	if v := stored["cooling"]; len(v) > 0 && hasAnyTech(techs, coolingTechs) {
		cooling := window(v, w)
		for i := range cooling {
			cooling[i] = math.Abs(cooling[i])
		}
		out["cooling"] = cooling
	}
	if v := stored["kitchen"]; anyPositive(v) {
		out["natural_gas"] = window(v, w)
	}
	return out
}

// window returns w.steps values of vals from w.offset, rounded to six
// decimals; a window running past the end continues from the start, so a
// leap year or a period crossing the year end still has a value per step.
func window(vals []float32, w seriesWindow) []float64 {
	out := make([]float64, w.steps)
	for i := range out {
		out[i] = math.Round(float64(vals[(w.offset+i)%len(vals)])*1e6) / 1e6
	}
	return out
}

// sumSeries adds two series of equal length; a missing one counts as zero.
func sumSeries(a, b []float32) []float32 {
	if len(a) == 0 {
		return b
	}
	if len(b) != len(a) {
		return a
	}
	out := make([]float32, len(a))
	for i := range a {
		out[i] = a[i] + b[i]
	}
	return out
}

// anyPositive reports whether vals has a value above zero.
func anyPositive(vals []float32) bool {
	for _, v := range vals {
		if v > 0 {
			return true
		}
	}
	return false
}

// hasAnyTech reports whether techs contains one of names.
func hasAnyTech(techs map[string]interface{}, names []string) bool {
	for _, n := range names {
		if _, ok := techs[n]; ok {
			return true
		}
	}
	return false
}

// ensureGasSupply gives feature the default gas_supply unless it has one.
func ensureGasSupply(feature map[string]interface{}) {
	techs, _ := feature["techs"].(map[string]interface{})
	if techs == nil {
		techs = map[string]interface{}{}
		feature["techs"] = techs
	}
	if _, ok := techs["gas_supply"]; !ok {
		techs["gas_supply"] = payload.DefaultTechnology("gas_supply")
	}
}
