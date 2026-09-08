package jobs

import (
	"encoding/json"
	"strings"
)

// CookingCarrier is the energy carrier a household cooks with, as BuEM's
// request contract defines it (building.cooking_carrier, v6-draft).
type CookingCarrier string

const (
	CookingElectric CookingCarrier = "electric"
	CookingGas      CookingCarrier = "gas"
	CookingNone     CookingCarrier = "none"
)

// DefaultCookingCarrier is the model-level fallback when neither
// config.cookingCarrier nor a building's properties.cooking_carrier is set.
//
// POLICY VALUE, NOT A TECHNICAL DEFAULT: with "electric" BuEM keeps cooking
// energy inside the electricity load and kitchen_kwh_a reads 0; with "gas"
// it reports cooking separately as kitchen_kwh_a (kWh_gas). Which one is
// right is country-specific and may need revisiting as more markets are
// added.
const DefaultCookingCarrier = CookingElectric

// DefaultIncludeDHW is the model-level fallback for building.include_dhw:
// report domestic hot water as hot_water_kwh_a alongside space heating.
const DefaultIncludeDHW = true

// cookingSettings is what run_buem sends BuEM per building for the cooking
// and hot-water terms.
type cookingSettings struct {
	Carrier    CookingCarrier
	IncludeDHW bool
}

// parseCookingCarrier returns the carrier v names, or "" for anything that
// is not one of BuEM's three values (case-insensitive, like BuEM itself).
func parseCookingCarrier(v string) CookingCarrier {
	switch CookingCarrier(strings.ToLower(strings.TrimSpace(v))) {
	case CookingElectric:
		return CookingElectric
	case CookingGas:
		return CookingGas
	case CookingNone:
		return CookingNone
	default:
		return ""
	}
}

// modelCookingSettings reads the model-level defaults from
// config.cookingCarrier and config.includeDhw (same top-level config map as
// energyVectors and refurbishmentLevel), falling back to
// DefaultCookingCarrier/DefaultIncludeDHW for an absent or invalid value.
func modelCookingSettings(config []byte) cookingSettings {
	out := cookingSettings{Carrier: DefaultCookingCarrier, IncludeDHW: DefaultIncludeDHW}
	var configMap map[string]interface{}
	if len(config) == 0 || json.Unmarshal(config, &configMap) != nil {
		return out
	}
	if s, _ := configMap["cookingCarrier"].(string); parseCookingCarrier(s) != "" {
		out.Carrier = parseCookingCarrier(s)
	}
	if b, ok := configMap["includeDhw"].(bool); ok {
		out.IncludeDHW = b
	}
	return out
}

// buildingCookingSettings applies a building's own overrides
// (properties.cooking_carrier, properties.include_dhw - set through the same
// building-properties save flow as construction_year and
// refurbishment_level) on top of the model defaults. A per-building value
// wins whenever present and valid; the model default fills the rest.
func buildingCookingSettings(props map[string]interface{}, modelDefault cookingSettings) cookingSettings {
	out := modelDefault
	if s, _ := props["cooking_carrier"].(string); parseCookingCarrier(s) != "" {
		out.Carrier = parseCookingCarrier(s)
	}
	if b, ok := props["include_dhw"].(bool); ok {
		out.IncludeDHW = b
	}
	return out
}
