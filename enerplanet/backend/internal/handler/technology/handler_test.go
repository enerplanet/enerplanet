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
