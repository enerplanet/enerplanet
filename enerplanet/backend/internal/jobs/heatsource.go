package jobs

import "encoding/json"

// HeatSource is a model's config.heatSource: where per-building heat demand
// comes from for the calculation.
type HeatSource string

const (
	// HeatSourceBuem resolves every building through City2TABULA, ignis and
	// BuEM: demand profiles at model creation, and the BuEM step before the
	// calculation is dispatched.
	HeatSourceBuem HeatSource = "buem"
	// HeatSourceEstimate skips both BuEM steps; the usage-class estimate and
	// the manually entered heat demand already in the payload are used as
	// they are.
	HeatSourceEstimate HeatSource = "estimate"
)

// ModelHeatSource reads config.heatSource (same top-level config map as
// energyVectors and refurbishmentLevel). Absent, invalid or unparseable
// values mean buem.
func ModelHeatSource(config []byte) HeatSource {
	var configMap map[string]interface{}
	if len(config) == 0 || json.Unmarshal(config, &configMap) != nil {
		return HeatSourceBuem
	}
	if s, _ := configMap["heatSource"].(string); HeatSource(s) == HeatSourceEstimate {
		return HeatSourceEstimate
	}
	return HeatSourceBuem
}
