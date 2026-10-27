package jobs

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestModelCookingSettings(t *testing.T) {
	def := cookingSettings{Carrier: DefaultCookingCarrier, IncludeDHW: DefaultIncludeDHW}

	assert.Equal(t, def, modelCookingSettings(nil), "no config")
	assert.Equal(t, def, modelCookingSettings([]byte(`null`)), "null config")
	assert.Equal(t, def, modelCookingSettings([]byte(`{}`)), "no keys")
	assert.Equal(t, def, modelCookingSettings([]byte(`{"cookingCarrier":"coal"}`)), "unknown carrier keeps the default")
	assert.Equal(t, cookingSettings{Carrier: CookingGas, IncludeDHW: true},
		modelCookingSettings([]byte(`{"cookingCarrier":"GAS"}`)), "case-insensitive, like BuEM")
	assert.Equal(t, cookingSettings{Carrier: CookingNone, IncludeDHW: false},
		modelCookingSettings([]byte(`{"cookingCarrier":"none","includeDhw":false}`)))
}

func TestBuildingCookingSettings_overridePrecedence(t *testing.T) {
	model := cookingSettings{Carrier: CookingElectric, IncludeDHW: true}

	assert.Equal(t, model, buildingCookingSettings(map[string]interface{}{}, model), "no override keeps the model default")
	assert.Equal(t, model, buildingCookingSettings(map[string]interface{}{"cooking_carrier": nil, "include_dhw": nil}, model), "nil pass-through keeps the model default")
	assert.Equal(t, cookingSettings{Carrier: CookingGas, IncludeDHW: true},
		buildingCookingSettings(map[string]interface{}{"cooking_carrier": "gas"}, model), "per-building carrier wins")
	assert.Equal(t, cookingSettings{Carrier: CookingElectric, IncludeDHW: false},
		buildingCookingSettings(map[string]interface{}{"include_dhw": false}, model), "per-building include_dhw wins")
	assert.Equal(t, model, buildingCookingSettings(map[string]interface{}{"cooking_carrier": "wood"}, model), "invalid override is ignored")
}
