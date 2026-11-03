package jobs

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCheckDemandCoverage(t *testing.T) {
	building := func(id string, series bool) map[string]interface{} {
		props := map[string]interface{}{"osm_id": id, "feature_type": "BasePOI"}
		if series {
			props["demand_series"] = map[string]interface{}{"electricity": []float64{1}}
		}
		return map[string]interface{}{"properties": props}
	}
	some := []interface{}{map[string]interface{}{"from": building("1", true), "to": building("2", false)}}
	w, err := checkDemandCoverage(some, nil)
	require.NoError(t, err)
	assert.Equal(t, &demandFallbackWarning{Code: "demand_fallback", Fallback: 1, Total: 2}, w)

	all := []interface{}{map[string]interface{}{"from": building("1", true)}}
	w, err = checkDemandCoverage(all, nil)
	require.NoError(t, err)
	assert.Nil(t, w)

	none := []interface{}{map[string]interface{}{"from": building("1", false)}}
	_, err = checkDemandCoverage(none, nil)
	assert.ErrorContains(t, err, "none of the model's 1 buildings")
}

func TestCheckHeatCoverage(t *testing.T) {
	building := func(id string, heatPump, heatSeries bool) map[string]interface{} {
		props := map[string]interface{}{"osm_id": id, "feature_type": "BasePOI"}
		if heatSeries {
			props["demand_series"] = map[string]interface{}{"heat": []float64{1}}
		}
		feature := map[string]interface{}{"properties": props}
		if heatPump {
			feature["techs"] = map[string]interface{}{"air_source_heat_pump": map[string]interface{}{}}
		}
		return feature
	}
	topology := func(buildings ...map[string]interface{}) []interface{} {
		out := make([]interface{}, len(buildings))
		for i, b := range buildings {
			out[i] = map[string]interface{}{"from": b}
		}
		return out
	}

	assert.NoError(t, checkHeatCoverage(topology(building("1", true, true), building("2", false, false)), nil),
		"a heated building with its heat series, and one without a heat technology")

	err := checkHeatCoverage(topology(building("1", true, true), building("2", true, false), building("3", true, false)), nil)
	assert.ErrorContains(t, err, "2 buildings with a heat technology have no BuEM heat profile")
	assert.ErrorContains(t, err, "2, 3")

	assert.NoError(t, checkHeatCoverage(topology(building("2", true, false)), map[string]bool{"2": true}),
		"a further way's heat is carried by its building's own way")
}
