package demand

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestProgress_CountsEachWayOnceUntilTheRunEnds(t *testing.T) {
	StartProgress(41)
	MarkComputed(41, "w1")
	MarkComputed(41, "w1")
	MarkComputed(41, "w2")
	MarkComputed(42, "w1")

	assert.Equal(t, int64(2), Computed(41), "a way with several 3D buildings counts once")
	assert.Equal(t, int64(0), Computed(42), "a model without a running analysis counts nothing")

	EndProgress(41)
	assert.Equal(t, int64(0), Computed(41), "linked results are counted by their rows")
}
