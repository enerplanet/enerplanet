package heatdemand

import (
	"context"
	"errors"
	"strings"
	"testing"

	"spatialhub_backend/internal/ignis"
)

// fakeIgnis is a hand-rolled IgnisResolver for exercising Resolve's ignis
// branch without a live ignis server.
type fakeIgnis struct {
	code       string
	qHNDKwhM2a float64
	matchErr   error
	calcErr    error
}

func (f fakeIgnis) ExistingStateVariant(ctx context.Context, iso2, buildingType string, year int) (string, error) {
	if f.matchErr != nil {
		return "", f.matchErr
	}
	return f.code, nil
}

func (f fakeIgnis) Calculate(ctx context.Context, variantCode string) (ignis.CalculateResult, error) {
	if f.calcErr != nil {
		return ignis.CalculateResult{}, f.calcErr
	}
	return ignis.CalculateResult{VariantCode: variantCode, QHNDKwhM2a: f.qHNDKwhM2a}, nil
}

func year(y int) *int { return &y }

func TestResolve_nonResidentialEstimate(t *testing.T) {
	got := Resolve(context.Background(), nil, Input{FClass: "office", FloorAreaM2: 200})

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
		if strings.Contains(w, "TABULA") {
			t.Errorf("non-residential should not carry a TABULA fallback warning, got %q", w)
		}
	}
}

func TestResolve_residentialWithoutIgnisWarnsWhyItFellBack(t *testing.T) {
	got := Resolve(context.Background(), nil, Input{FClass: "detached", FloorAreaM2: 120})

	if got.Source != SourceEstimate {
		t.Fatalf("source = %q, want %q", got.Source, SourceEstimate)
	}
	if got.HeatingDemandKwhA != 12000 {
		t.Errorf("annual = %v, want 12000", got.HeatingDemandKwhA)
	}
	found := false
	for _, w := range got.Warnings {
		if strings.Contains(w, "TABULA archetype path") {
			found = true
		}
	}
	if !found {
		t.Errorf("residential should carry a TABULA-path fallback warning, got %v", got.Warnings)
	}
}

func TestResolve_zeroAreaIsZeroWithWarning(t *testing.T) {
	got := Resolve(context.Background(), nil, Input{FClass: "office", FloorAreaM2: 0})

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

func TestResolve_residentialWithIgnisSucceeds(t *testing.T) {
	client := fakeIgnis{code: "DE.N.SFH.05.Gen", qHNDKwhM2a: 100}
	in := Input{FClass: "detached", Country: "germany", ConstructionYear: year(1975), FloorAreaM2: 150}

	got := Resolve(context.Background(), client, in)

	if got.Source != SourceIgnis {
		t.Fatalf("source = %q, want %q", got.Source, SourceIgnis)
	}
	if got.HeatingDemandKwhA != 15000 { // 100 kWh/(m2.a) * 150 m2
		t.Errorf("annual = %v, want 15000", got.HeatingDemandKwhA)
	}
	if got.TabulaVariantCode == nil || *got.TabulaVariantCode != "DE.N.SFH.05.Gen" {
		t.Errorf("tabula code = %v, want DE.N.SFH.05.Gen", got.TabulaVariantCode)
	}
}

func TestResolve_ignisFailureFallsBackToEstimate(t *testing.T) {
	client := fakeIgnis{matchErr: errors.New("ignis unreachable")}
	in := Input{FClass: "detached", Country: "germany", ConstructionYear: year(1975), FloorAreaM2: 120}

	got := Resolve(context.Background(), client, in)

	if got.Source != SourceEstimate {
		t.Fatalf("source = %q, want %q (ignis failure should fall back)", got.Source, SourceEstimate)
	}
	if got.HeatingDemandKwhA != 12000 {
		t.Errorf("annual = %v, want 12000", got.HeatingDemandKwhA)
	}
}

func TestResolveVariant_declineReasons(t *testing.T) {
	ctx := context.Background()
	client := fakeIgnis{code: "DE.N.SFH.05.Gen"}

	cases := []struct {
		name    string
		fClass  string
		btype   string
		country string
		year    *int
		wantErr error
	}{
		{"non-residential", "office", "", "germany", year(1975), ErrNotResidential},
		{"no year", "detached", "", "germany", nil, ErrYearRequired},
		{"no country", "detached", "", "", year(1975), ErrCountryRequired},
		{"unknown type", "residential", "", "germany", year(1975), ErrUnknownType}, // residential per categoryOf, no TabulaType keyword match
		{"unknown country", "detached", "", "atlantis", year(1975), ErrUnknownCountry},
	}
	for _, tt := range cases {
		t.Run(tt.name, func(t *testing.T) {
			_, err := ResolveVariant(ctx, client, tt.fClass, tt.btype, tt.country, tt.year)
			if !errors.Is(err, tt.wantErr) {
				t.Errorf("err = %v, want %v", err, tt.wantErr)
			}
		})
	}
}

func TestResolveVariant_succeedsWithExplicitBuildingType(t *testing.T) {
	client := fakeIgnis{code: "DE.N.MFH.03.Gen"}
	// "residential" alone has no TABULA type keyword match; an explicit
	// override must still work.
	code, err := ResolveVariant(context.Background(), client, "residential", "MFH", "germany", year(1990))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if code != "DE.N.MFH.03.Gen" {
		t.Errorf("code = %q, want DE.N.MFH.03.Gen", code)
	}
}
