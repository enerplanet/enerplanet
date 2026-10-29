package model

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestParseModelIDs(t *testing.T) {
	ids, err := parseModelIDs(" 12, 31 ,,7")
	require.NoError(t, err)
	assert.Equal(t, []uint{12, 31, 7}, ids)

	ids, err = parseModelIDs("")
	require.NoError(t, err)
	assert.Empty(t, ids, "an empty list is valid and matches nothing")

	for _, bad := range []string{"12,x", "-3", "0", "1.5"} {
		_, err := parseModelIDs(bad)
		assert.Error(t, err, bad)
	}
}
