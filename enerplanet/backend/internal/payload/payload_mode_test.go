package payload

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestRunMode(t *testing.T) {
	for mode, want := range map[interface{}]string{"operate": "operate", "plan": "plan", "dispatch": "", 1: "", nil: ""} {
		assert.Equal(t, want, runMode(map[string]interface{}{"mode": mode}), "mode %v", mode)
	}
	assert.Empty(t, runMode(map[string]interface{}{}))
}
