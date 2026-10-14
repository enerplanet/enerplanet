package series

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestOwnerValidate_ExactlyOneOwner(t *testing.T) {
	assert.NoError(t, Owner{ModelID: 7}.validate())
	assert.NoError(t, Owner{DraftID: "draft-1"}.validate())
	assert.Error(t, Owner{}.validate())
	assert.Error(t, Owner{ModelID: 7, DraftID: "draft-1"}.validate())
}

func TestNewProfileValidate(t *testing.T) {
	valid := NewProfile{
		Key: "k", Origin: "buem", StartTime: time.Unix(0, 0), ResolutionMinutes: 60,
		Series: map[string]SeriesData{"heating": {Unit: "kWh", Values: []float32{1}}},
	}
	assert.NoError(t, valid.validate())

	noKey := valid
	noKey.Key = ""
	assert.Error(t, noKey.validate())

	noSeries := valid
	noSeries.Series = nil
	assert.Error(t, noSeries.validate())

	badResolution := valid
	badResolution.ResolutionMinutes = 0
	assert.Error(t, badResolution.validate())

	emptyValues := valid
	emptyValues.Series = map[string]SeriesData{"heating": {Unit: "kWh"}}
	assert.Error(t, emptyValues.validate())
}
