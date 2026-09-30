package jobs

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

// The framework set is fixed per TentaCron target (a request selects a target by
// name, never a URL), so the backend maps a requested set onto a target name.
// Default must stay the full pypsa,calliope target.
func TestMemeTargetFor(t *testing.T) {
	cases := map[string]string{
		"":               memeTargetDefault,
		"pypsa,calliope": memeTargetDefault,
		"adopt-net0":     memeTargetDefault, // unknown set keeps the full target
		"pypsa":          memeTargetPyPSAOnly,
		" pypsa ":        memeTargetPyPSAOnly,
		"pypsa only":     memeTargetDefault,
	}
	for in, want := range cases {
		assert.Equal(t, want, MemeTargetFor(in), "frameworks=%q", in)
	}
}
