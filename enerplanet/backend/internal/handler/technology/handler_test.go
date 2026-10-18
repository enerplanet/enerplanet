package technology

import (
	"testing"

	"github.com/stretchr/testify/assert"

	techstore "spatialhub_backend/internal/store/technology"
)

func TestSupportedDTOsLeavesOutUnsupportedTechnologies(t *testing.T) {
	dtos := supportedDTOs([]techstore.Technology{{Key: "pv_supply"}, {Key: "wind_onshore"}, {Key: "battery_storage"}, {Key: "households_supply"}})

	keys := make([]string, len(dtos))
	for i, d := range dtos {
		keys[i] = d.Key
	}
	assert.Equal(t, []string{"pv_supply", "battery_storage"}, keys)
}
