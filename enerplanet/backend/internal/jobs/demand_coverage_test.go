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
	w, err := checkDemandCoverage(some)
	require.NoError(t, err)
	assert.Equal(t, &demandFallbackWarning{Code: "demand_fallback", Fallback: 1, Total: 2}, w)

	all := []interface{}{map[string]interface{}{"from": building("1", true)}}
	w, err = checkDemandCoverage(all)
	require.NoError(t, err)
	assert.Nil(t, w)

	none := []interface{}{map[string]interface{}{"from": building("1", false)}}
	_, err = checkDemandCoverage(none)
	assert.ErrorContains(t, err, "none of the model's 1 buildings")
}
