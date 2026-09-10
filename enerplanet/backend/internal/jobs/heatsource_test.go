package jobs

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestModelHeatSource(t *testing.T) {
	assert.Equal(t, HeatSourceBuem, ModelHeatSource(nil), "no config")
	assert.Equal(t, HeatSourceBuem, ModelHeatSource([]byte(`null`)))
	assert.Equal(t, HeatSourceBuem, ModelHeatSource([]byte(`{}`)), "absent key")
	assert.Equal(t, HeatSourceBuem, ModelHeatSource([]byte(`{"heatSource":"buem"}`)))
	assert.Equal(t, HeatSourceBuem, ModelHeatSource([]byte(`{"heatSource":"magic"}`)), "unknown value falls back to buem")
	assert.Equal(t, HeatSourceEstimate, ModelHeatSource([]byte(`{"heatSource":"estimate"}`)))
}
