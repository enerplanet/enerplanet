package contenthash

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestCanonical_SortsKeysAndDropsWhitespace(t *testing.T) {
	got, err := Canonical([]byte(`{ "b": [ {"y": 1, "x": 2} ], "a": "s" }`))
	require.NoError(t, err)
	assert.Equal(t, `{"a":"s","b":[{"x":2,"y":1}]}`, string(got))
}

func TestCanonical_KeepsNumberText(t *testing.T) {
	got, err := Canonical([]byte(`{"u": 1.0, "big": 12345678901234567890}`))
	require.NoError(t, err)
	assert.Equal(t, `{"big":12345678901234567890,"u":1.0}`, string(got))
}

func TestCanonical_RejectsInvalidAndTrailingData(t *testing.T) {
	_, err := Canonical([]byte(`{"a":`))
	assert.Error(t, err)
	_, err = Canonical([]byte(`{"a":1} {"b":2}`))
	assert.Error(t, err)
}

func TestOf_IgnoresKeyOrderAndWhitespace(t *testing.T) {
	a, err := Of(json.RawMessage(`{"thermal": {"lb": 18, "ub": 21}, "id": "x"}`))
	require.NoError(t, err)
	b, err := Of(json.RawMessage(`{"id":"x","thermal":{"ub":21,"lb":18}}`))
	require.NoError(t, err)
	assert.Equal(t, a, b)
	assert.Len(t, a, 64)
}

func TestOf_DiffersWhenAValueDiffers(t *testing.T) {
	a, err := Of(map[string]any{"u": 0.9})
	require.NoError(t, err)
	b, err := Of(map[string]any{"u": 1.1})
	require.NoError(t, err)
	assert.NotEqual(t, a, b)
}
