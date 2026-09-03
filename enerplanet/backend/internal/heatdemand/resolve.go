package heatdemand

import "math"

// Source names where a resolved heating demand came from.
const (
	SourceBuEM     = "buem"     // 3D thermal model, hourly, multi-vector
	SourceIgnis    = "ignis"    // TABULA archetype, annual heating only
	SourceEstimate = "estimate" // specific-demand-by-usage-class lookup
)

// Input is what the caller knows about a building. FClass is always required
// (it drives the fallback and the residential test); the rest feed the ignis
// path once it is wired.
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

// Resolve picks a heating demand for the building. The intended order is
// BuEM > ignis > estimate; today only the estimate path runs. A residential
// building carries a warning that the ignis path is not yet available.
func Resolve(in Input) Result {
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
		res.Warnings = append(res.Warnings,
			"residential building: the TABULA archetype path (ignis) is not yet available; using the usage-class estimate")
	}
	if in.FloorAreaM2 <= 0 {
		res.Warnings = append(res.Warnings, "floor area is missing or zero; heating demand is 0")
	}

	return res
}
