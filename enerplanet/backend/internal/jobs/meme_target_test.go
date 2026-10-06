package jobs

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// The framework set is fixed per TentaCron target (a request selects a target by
// name, never a URL), so the backend maps a requested set onto a target name.
// Only two targets exist: Calliope (the default) and a lone-pypsa PyPSA leg.
func TestMemeTargetFor(t *testing.T) {
	cases := map[string]string{
		"":               memeTargetCalliopeOnly,
		"calliope":       memeTargetCalliopeOnly, // unknown/multi set keeps the Calliope default
		"pypsa,calliope": memeTargetCalliopeOnly,
		"adopt-net0":     memeTargetCalliopeOnly,
		"pypsa":          memeTargetPyPSAOnly,
		" pypsa ":        memeTargetPyPSAOnly,
		"pypsa only":     memeTargetCalliopeOnly,
	}
	for in, want := range cases {
		assert.Equal(t, want, MemeTargetFor(in), "frameworks=%q", in)
	}
}
