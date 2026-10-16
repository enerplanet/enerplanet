package jobs

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"

	"spatialhub_backend/internal/store/series"
)

func seriesFeature(osmID string, techs map[string]interface{}) map[string]interface{} {
	return map[string]interface{}{
		"properties": map[string]interface{}{"osm_id": osmID, "feature_type": "BasePOI"},
		"techs":      techs,
	}
}

func link(osmID, name string, vals ...float32) series.LinkedSeries {
	return series.LinkedSeries{BuildingRef: osmID, Series: name, ResolutionMinutes: 60, Unit: "kW", Vals: vals}
}

func demandSeriesOf(feature map[string]interface{}) map[string]interface{} {
	got, _ := feature["properties"].(map[string]interface{})["demand_series"].(map[string]interface{})
	return got
}

func TestModelSeriesWindow(t *testing.T) {
	day := func(y int, m time.Month, d int) time.Time { return time.Date(y, m, d, 0, 0, 0, 0, time.UTC) }
	assert.Equal(t, seriesWindow{offset: 0, steps: 8760, resolution: 60}, modelSeriesWindow(day(2018, 1, 1), day(2018, 12, 31), 60),
		"a whole year: the last day is included")
	assert.Equal(t, seriesWindow{offset: 31 * 24, steps: 2 * 24, resolution: 60}, modelSeriesWindow(day(2018, 2, 1), day(2018, 2, 2), 60))
}

func TestAttachDemandSeries(t *testing.T) {
	heated := seriesFeature("1", map[string]interface{}{"air_source_heat_pump": map[string]interface{}{}})
	plain := seriesFeature("2", nil)
	cooled := seriesFeature("3", map[string]interface{}{"air_conditioner": map[string]interface{}{}, "gas_boiler": map[string]interface{}{}})
	unlinked := seriesFeature("4", nil)
	topology := []interface{}{
		map[string]interface{}{"from": heated, "to": map[string]interface{}{"properties": map[string]interface{}{"feature_type": "TopologyNode"}}},
		map[string]interface{}{"from": plain}, map[string]interface{}{"from": cooled}, map[string]interface{}{"from": unlinked},
	}
	linked := []series.LinkedSeries{
		link("1", "electricity", 1, 2, 3, 4), link("1", "heating", 5, 6, 7, 8), link("1", "hot_water", 1, 0, 1, 0),
		link("2", "electricity", 1, 1, 1, 1), link("2", "heating", 9, 9, 9, 9),
		link("3", "electricity", 1, 1, 1, 1), link("3", "heating", 2, 2, 2, 2), link("3", "cooling", 0, -1.5, -2, 0), link("3", "kitchen", 0, 0, 0.5, 0),
		{BuildingRef: "1", Part: "roof_1", Series: "pv", ResolutionMinutes: 60, Vals: []float32{9, 9, 9, 9}},
	}

	attachDemandSeries(topology, linked, seriesWindow{offset: 2, steps: 3, resolution: 60})

	assert.Equal(t, map[string]interface{}{
		"electricity": []float64{3, 4, 1},
		"heat":        []float64{8, 8, 6},
	}, demandSeriesOf(heated), "the window starts at the offset and wraps around; heat is heating plus hot water")

	assert.Equal(t, map[string]interface{}{"electricity": []float64{1, 1, 1}}, demandSeriesOf(plain),
		"no heat technology, so no heat demand that nothing could supply")

	assert.Equal(t, map[string]interface{}{
		"electricity": []float64{1, 1, 1},
		"heat":        []float64{2, 2, 2},
		"cooling":     []float64{2, 0, 0},
		"natural_gas": []float64{0.5, 0, 0},
	}, demandSeriesOf(cooled), "cooling is positive; the kitchen series is gas for cooking")
	assert.Equal(t, 0.04, cooled["techs"].(map[string]interface{})["gas_supply"].(map[string]interface{})["cost_om_con"],
		"gas used at the building needs a gas supply")

	assert.Nil(t, demandSeriesOf(unlinked), "a building without stored series keeps its yearly numbers")
	assert.Nil(t, plain["techs"], "no gas, no gas supply")
}

func TestAttachDemandSeries_skipsAnotherResolution(t *testing.T) {
	f := seriesFeature("1", nil)
	attachDemandSeries([]interface{}{map[string]interface{}{"from": f}},
		[]series.LinkedSeries{link("1", "electricity", 1, 2, 3, 4)}, seriesWindow{offset: 0, steps: 4, resolution: 15})
	assert.Nil(t, demandSeriesOf(f), "an hourly series cannot fill a 15-minute model")
}

func TestAttachDemandSeries_keepsAUsersGasSupply(t *testing.T) {
	own := map[string]interface{}{"cost_om_con": 0.09}
	f := seriesFeature("1", map[string]interface{}{"gas_boiler": map[string]interface{}{}, "gas_supply": own})
	attachDemandSeries([]interface{}{map[string]interface{}{"from": f}},
		[]series.LinkedSeries{link("1", "heating", 1, 1)}, seriesWindow{offset: 0, steps: 2, resolution: 60})
	assert.Equal(t, own, f["techs"].(map[string]interface{})["gas_supply"])
}
