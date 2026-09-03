package heatdemand

import (
	"strings"
	"testing"
)

func TestResolve_nonResidentialEstimate(t *testing.T) {
	got := Resolve(Input{FClass: "office", FloorAreaM2: 200})

	if got.Source != SourceEstimate {
		t.Fatalf("source = %q, want %q", got.Source, SourceEstimate)
	}
	if got.SpecificHeatingDemandKwhM2a != 80 {
		t.Errorf("specific = %v, want 80", got.SpecificHeatingDemandKwhM2a)
	}
	if got.HeatingDemandKwhA != 16000 {
		t.Errorf("annual = %v, want 16000", got.HeatingDemandKwhA)
	}
	if got.TabulaVariantCode != nil {
		t.Errorf("tabula code should be nil, got %v", *got.TabulaVariantCode)
	}
	for _, w := range got.Warnings {
		if strings.Contains(w, "ignis") {
			t.Errorf("non-residential should not carry the ignis warning, got %q", w)
		}
	}
}

func TestResolve_residentialWarnsAboutIgnis(t *testing.T) {
	got := Resolve(Input{FClass: "detached", FloorAreaM2: 120})

	if got.Source != SourceEstimate {
		t.Fatalf("source = %q, want %q", got.Source, SourceEstimate)
	}
	if got.HeatingDemandKwhA != 12000 {
		t.Errorf("annual = %v, want 12000", got.HeatingDemandKwhA)
	}
	found := false
	for _, w := range got.Warnings {
		if strings.Contains(w, "ignis") {
			found = true
		}
	}
	if !found {
		t.Errorf("residential should carry the ignis-pending warning, got %v", got.Warnings)
	}
}

func TestResolve_zeroAreaIsZeroWithWarning(t *testing.T) {
	got := Resolve(Input{FClass: "office", FloorAreaM2: 0})

	if got.HeatingDemandKwhA != 0 {
		t.Errorf("annual = %v, want 0", got.HeatingDemandKwhA)
	}
	found := false
	for _, w := range got.Warnings {
		if strings.Contains(w, "floor area") {
			found = true
		}
	}
	if !found {
		t.Errorf("zero area should warn, got %v", got.Warnings)
	}
}
