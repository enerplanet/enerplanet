package config

import (
	"strings"
	"testing"
)

// Stored BuEM results are kept only when BuEM's reported model_version equals
// BUEM_VERSION, and BuEM reports X.Y.Z only for full release tags.
func TestValidateBuemVersion(t *testing.T) {
	for _, v := range []string{"6.10.0", "7.0.12"} {
		if err := ValidateBuemVersion(v); err != nil {
			t.Errorf("ValidateBuemVersion(%q) = %v, want nil", v, err)
		}
	}
	for _, v := range []string{"", "6.10", "latest", "v6.10.0", "enerplanet", "sha-21f79d7", "BUEM-v3.0"} {
		err := ValidateBuemVersion(v)
		if err == nil {
			t.Errorf("ValidateBuemVersion(%q) = nil, want an error", v)
			continue
		}
		if v != "" && !strings.Contains(err.Error(), v) {
			t.Errorf("error %q does not name the value %q", err, v)
		}
	}
}
