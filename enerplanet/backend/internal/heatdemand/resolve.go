package heatdemand

import (
	"context"
	"errors"
	"fmt"
	"math"

	"spatialhub_backend/internal/ignis"
)

// Source names where a resolved heating demand came from.
const (
	SourceBuEM     = "buem"     // 3D thermal model, hourly, multi-vector
	SourceIgnis    = "ignis"    // TABULA archetype, annual heating only
	SourceEstimate = "estimate" // specific-demand-by-usage-class lookup
)

// Input is what the caller knows about a building. FClass is always required
// (it drives the fallback and the residential test); Country and
// ConstructionYear are required for the ignis path.
type Input struct {
	FClass           string
	BuildingType     string // caller-supplied TABULA type, overrides the FClass guess
	Country          string
	ConstructionYear *int
	FloorAreaM2      float64
}

// Result is the resolved demand plus its provenance. HourlyProfile is set only
// for SourceBuEM; TabulaVariantCode only for SourceIgnis and SourceBuEM.
type Result struct {
	Source                      string
	HeatingDemandKwhA           int64
	SpecificHeatingDemandKwhM2a float64
	TabulaVariantCode           *string
	Warnings                    []string
}

// VariantResolver is the subset of *ignis.Client variant resolution needs, so
// tests can fake it without a live ignis server.
type VariantResolver interface {
	ExistingStateVariant(ctx context.Context, iso2, buildingType string, year int) (string, error)
}

// Errors ResolveVariant returns for the reasons a caller cannot go via ignis.
// Each names a distinct, actionable cause, so a caller building a warning
// message (the resolve endpoint) or deciding whether to try at all (run_buem)
// does not have to re-derive it from the inputs.
var (
	ErrNotResidential  = errors.New("heatdemand: TABULA covers residential building types only")
	ErrYearRequired    = errors.New("heatdemand: construction year is required for the TABULA archetype path")
	ErrCountryRequired = errors.New("heatdemand: country is required for the TABULA archetype path")
	ErrUnknownType     = errors.New("heatdemand: could not determine a TABULA building type (SFH/TH/MFH)")
	ErrUnknownCountry  = errors.New("heatdemand: no TABULA country mapping for this country")
)

// ResolveVariant resolves the TABULA existing-state variant code for a
// building from its f-class, an optional caller-supplied TABULA type
// override, country and construction year. Shared by the resolve endpoint's
// ignis path and run_buem's U-value attachment so both resolve the same
// variant from the same inputs. Returns one of the Err* sentinels above when
// the inputs do not support the ignis path at all (no network call is made);
// any other error is a live ignis failure (unreachable, no matching variant).
func ResolveVariant(ctx context.Context, client VariantResolver, fClass, buildingTypeOverride, country string, year *int) (string, error) {
	if !IsResidential(fClass) {
		return "", ErrNotResidential
	}
	if year == nil {
		return "", ErrYearRequired
	}
	if country == "" {
		return "", ErrCountryRequired
	}
	buildingType := buildingTypeOverride
	if buildingType == "" {
		buildingType = TabulaType(fClass)
	}
	if buildingType == "" {
		return "", ErrUnknownType
	}
	iso2, ok := ignis.ISO2ForCountry(country)
	if !ok {
		return "", ErrUnknownCountry
	}
	return client.ExistingStateVariant(ctx, iso2, buildingType, *year)
}

// IgnisResolver is the subset of *ignis.Client Resolve needs.
type IgnisResolver interface {
	VariantResolver
	Calculate(ctx context.Context, variantCode string) (ignis.CalculateResult, error)
}

// Resolve picks a heating demand for the building: BuEM > ignis > estimate.
// The BuEM branch is not wired here (#57 — it needs a persisted per-building
// thermal profile to read, which does not exist yet). ignisClient may be nil,
// meaning the ignis branch is skipped; any ignis failure falls through to the
// estimate rather than failing the whole resolution.
func Resolve(ctx context.Context, ignisClient IgnisResolver, in Input) Result {
	if ignisClient != nil {
		if result, ok := resolveViaIgnis(ctx, ignisClient, in); ok {
			return result
		}
	}
	return resolveViaEstimate(in)
}

// resolveViaIgnis attempts the TABULA archetype path. ok is false whenever the
// caller should fall through to the estimate; resolveViaEstimate re-derives
// the specific reason for its warning, so there is one place that assembles
// the final warning list.
func resolveViaIgnis(ctx context.Context, client IgnisResolver, in Input) (Result, bool) {
	code, err := ResolveVariant(ctx, client, in.FClass, in.BuildingType, in.Country, in.ConstructionYear)
	if err != nil {
		return Result{}, false
	}

	calc, err := client.Calculate(ctx, code)
	if err != nil {
		return Result{}, false
	}

	kwhA := int64(0)
	if in.FloorAreaM2 > 0 {
		kwhA = int64(math.Round(in.FloorAreaM2 * calc.QHNDKwhM2a))
	}
	var warnings []string
	if in.FloorAreaM2 <= 0 {
		warnings = append(warnings, "floor area is missing or zero; heating demand is 0")
	}
	return Result{
		Source:                      SourceIgnis,
		HeatingDemandKwhA:           kwhA,
		SpecificHeatingDemandKwhM2a: calc.QHNDKwhM2a,
		TabulaVariantCode:           &code,
		Warnings:                    warnings,
	}, true
}

// resolveViaEstimate is the last-resort path: area x specific-demand-by-
// usage-class. Always succeeds (falls back to the category default), so this
// never leaves a caller without a number.
func resolveViaEstimate(in Input) Result {
	spec := SpecificDemandKwhM2a(in.FClass)
	kwh := int64(0)
	if in.FloorAreaM2 > 0 {
		kwh = int64(math.Round(in.FloorAreaM2 * spec))
	}

	res := Result{
		Source:                      SourceEstimate,
		HeatingDemandKwhA:           kwh,
		SpecificHeatingDemandKwhM2a: spec,
	}

	if IsResidential(in.FClass) {
		res.Warnings = append(res.Warnings, estimateFallbackReason(in))
	}
	if in.FloorAreaM2 <= 0 {
		res.Warnings = append(res.Warnings, "floor area is missing or zero; heating demand is 0")
	}
	return res
}

// estimateFallbackReason explains, for a residential building, why the ignis
// path was not used — so a caller resolving without ignis wired, with missing
// inputs, or against an unmatched archetype sees why it fell back, not just
// that it did. It re-derives the same checks ResolveVariant makes; a genuine
// ignis network failure or "no archetype for this year" cannot be
// distinguished from here and gets the generic last case.
func estimateFallbackReason(in Input) string {
	switch {
	case in.ConstructionYear == nil:
		return "residential building: " + ErrYearRequired.Error() + "; using the usage-class estimate"
	case in.Country == "":
		return "residential building: " + ErrCountryRequired.Error() + "; using the usage-class estimate"
	case in.BuildingType == "" && TabulaType(in.FClass) == "":
		return "residential building: " + ErrUnknownType.Error() + "; using the usage-class estimate"
	default:
		if _, ok := ignis.ISO2ForCountry(in.Country); !ok {
			return fmt.Sprintf("residential building: no TABULA country mapping for %q; using the usage-class estimate", in.Country)
		}
		return "residential building: no matching TABULA archetype, or ignis was unavailable; using the usage-class estimate"
	}
}
