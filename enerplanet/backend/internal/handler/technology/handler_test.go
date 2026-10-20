package technology

import (
	"math"
	"testing"

	"github.com/stretchr/testify/assert"

	techstore "spatialhub_backend/internal/store/technology"
)

func TestSupportedDTOsLeavesOutUnsupportedTechnologies(t *testing.T) {
	dtos := supportedDTOs([]techstore.Technology{
		{Key: "pv_supply", Type: "pv_supply"},
		{Key: "wind_onshore", Type: "wind_onshore"},
		{Key: "pv_topcon_8kw", Type: "pv_supply"},
		{Key: "households_supply", Type: "households_supply"},
	})

	keys := make([]string, len(dtos))
	for i, d := range dtos {
		keys[i] = d.Key
	}
	assert.Equal(t, []string{"pv_supply", "pv_topcon_8kw"}, keys)
}

// A boiler's unbounded cont_energy_cap_max is stored as Infinity; sent as null,
// a building took null as its size and the T1K translation refused the model.
func TestConstraintDTOCarriesInfiniteDefaultAsINF(t *testing.T) {
	inf := math.Inf(1)
	dto := toConstraintDTO(&techstore.TechnologyConstraint{Key: "cont_energy_cap_max", DefaultValue: &inf})
	assert.Equal(t, "INF", dto.DefaultValue)

	back := fromConstraintDTO(&dto)
	if assert.NotNil(t, back.DefaultValue) {
		assert.True(t, math.IsInf(*back.DefaultValue, 1), "INF must be stored as Infinity again, got %v", *back.DefaultValue)
	}
}

// Only a technology the simulation models can get a new product; a missing
// type falls back to the key, as for the seeded defaults.
func TestCheckNewTechnology(t *testing.T) {
	cases := map[string]struct {
		dto  TechnologyDTO
		fail bool
	}{
		"supported type":     {TechnologyDTO{Key: "pv_supply_x_1a2b3c", Type: "pv_supply", Alias: "X"}, false},
		"key as type":        {TechnologyDTO{Key: "gas_boiler", Alias: "Gas boiler"}, false},
		"user-defined type":  {TechnologyDTO{Key: "solar_supply", Type: "solar_supply", Alias: "Solar"}, true},
		"unsupported legacy": {TechnologyDTO{Key: "wind_onshore", Alias: "Wind"}, true},
		"no name":            {TechnologyDTO{Key: "pv_supply_a", Type: "pv_supply"}, true},
	}
	for name, tc := range cases {
		err := checkNewTechnology(fromTechnologyDTO(&tc.dto, "u1"))
		assert.Equal(t, tc.fail, err != nil, "%s: err = %v", name, err)
	}
}
