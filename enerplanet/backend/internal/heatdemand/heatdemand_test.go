package heatdemand

import "testing"

func TestNormalize(t *testing.T) {
	cases := map[string]string{
		"Detached":            "detached",
		"  semi-detached  ":   "semi_detached",
		"Semi Detached House": "semi_detached_house",
		"NURSING__HOME":       "nursing_home",
	}
	for in, want := range cases {
		if got := Normalize(in); got != want {
			t.Errorf("Normalize(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestSpecificDemandKwhM2a(t *testing.T) {
	if got := SpecificDemandKwhM2a("detached"); got != 100 {
		t.Errorf("direct hit: got %v, want 100", got)
	}
	// "villa" is not in the table but reads as residential.
	if got := SpecificDemandKwhM2a("villa"); got != categoryFallbackKwhM2a[categoryResidential] {
		t.Errorf("residential fallback: got %v, want %v", got, categoryFallbackKwhM2a[categoryResidential])
	}
	// A class that matches no category keyword falls to the default.
	if got := SpecificDemandKwhM2a("zeppelin_hangar"); got != specificDemandKwhM2a["default"] {
		t.Errorf("default fallback: got %v, want %v", got, specificDemandKwhM2a["default"])
	}
}

func TestIsResidential(t *testing.T) {
	res := []string{"detached", "SFH", "apartments", "townhouse", "bungalow", "residential"}
	nonRes := []string{"office", "school", "warehouse", "hospital", "farm", "retail"}
	for _, c := range res {
		if !IsResidential(c) {
			t.Errorf("IsResidential(%q) = false, want true", c)
		}
	}
	for _, c := range nonRes {
		if IsResidential(c) {
			t.Errorf("IsResidential(%q) = true, want false", c)
		}
	}
}

func TestTabulaType(t *testing.T) {
	cases := map[string]string{
		"detached":   "SFH",
		"bungalow":   "SFH",
		"terrace":    "TH",
		"townhouse":  "TH",
		"apartments": "MFH",
		"mfh":        "MFH",
		"office":     "",
		"school":     "",
	}
	for in, want := range cases {
		if got := TabulaType(in); got != want {
			t.Errorf("TabulaType(%q) = %q, want %q", in, got, want)
		}
	}
}
