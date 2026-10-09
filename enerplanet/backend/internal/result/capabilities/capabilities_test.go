package capabilities

import (
	"encoding/json"
	"testing"
)

func TestForLegacyAndFullGridPFAreFull(t *testing.T) {
	want := Capabilities{
		Convergence:  true,
		Voltage:      true,
		Power:        true,
		Transformers: true,
		LineLoading:  true,
		Curtailment:  true,
		Losses:       true,
	}
	for _, s := range []Source{SourceLegacy, SourceFullGridPF} {
		if got := For(s); got != want {
			t.Errorf("For(%q) = %+v, want %+v", s, got, want)
		}
	}
}

func TestForMemeClaimsUtilisationOnly(t *testing.T) {
	got := For(SourceMeme)
	if got.Convergence || got.Voltage || got.Power || got.Transformers {
		t.Errorf("For(meme) claims electrical data it cannot provide: %+v", got)
	}
	if !got.LineLoading || !got.UtilizationOnly {
		t.Errorf("For(meme) must offer line loading as utilisation: %+v", got)
	}
	// A Coati/MEME bundle has no curtailment source and no loss data (its
	// transport arcs have no impedance): claiming either makes the Grid render
	// a fake "0.00 kW" loss per line.
	if got.Curtailment || got.Losses {
		t.Errorf("For(meme) must NOT claim curtailment or losses: %+v", got)
	}
}

// An unknown source must claim nothing, never the full set.
func TestForUnknownClaimsNothing(t *testing.T) {
	for _, s := range []Source{"", "webservice", "sorcery"} {
		if got := (For(s)); got != (Capabilities{}) {
			t.Errorf("For(%q) = %+v, want the zero capability set", s, got)
		}
	}
}

// The JSON keys are the API contract the frontend reads; pin them.
func TestCapabilitiesJSONKeys(t *testing.T) {
	raw, err := json.Marshal(For(SourceMeme))
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}
	var m map[string]any
	if err := json.Unmarshal(raw, &m); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	for _, key := range []string{
		"convergence", "voltage", "power", "transformers",
		"lineLoading", "utilizationOnly", "curtailment", "losses",
	} {
		if _, ok := m[key]; !ok {
			t.Errorf("capabilities JSON is missing key %q", key)
		}
	}
}
