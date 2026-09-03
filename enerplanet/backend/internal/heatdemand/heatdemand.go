// Package heatdemand resolves a building's annual space-heating demand from the
// best source available: a BuEM 3D thermal model, an ignis TABULA-archetype
// calculation, or, as a last resort, a specific-demand-by-usage-class lookup.
//
// Only the last-resort path is wired today. The ignis path lands with #50 (it
// needs ignis to map a construction year to a TABULA period); the BuEM path
// needs per-building thermal blocks to be persisted first (#57). The Resolve
// contract already carries every field both will populate, so callers do not
// change when they arrive.
package heatdemand

import "strings"

// specificDemandKwhM2a is yearly space-heating-plus-hot-water demand in
// kWh/m2/year by normalised OSM usage class, for typical central-European
// building stock. It is the fallback when neither BuEM nor ignis can produce a
// figure, and the only option for non-residential buildings (TABULA, and so
// ignis, covers residential typologies only).
var specificDemandKwhM2a = map[string]float64{
	"apartment":          90,
	"apartments":         85,
	"detached":           100,
	"semidetached_house": 95,
	"terrace":            85,
	"townhouse":          85,
	"house":              100,
	"residential":        90,
	"bungalow":           95,
	"dormitory":          80,
	"sfh":                100,
	"mfh":                85,

	"office":       80,
	"commercial":   85,
	"retail":       90,
	"shop":         90,
	"supermarket":  110,
	"mall":         100,
	"restaurant":   140,
	"cafe":         130,
	"bar":          130,
	"fast_food":    130,
	"bakery":       150,
	"butcher":      130,
	"warehouse":    60,
	"industrial":   100,
	"factory":      120,
	"workshop":     100,
	"manufacture":  110,
	"logistics":    60,
	"storage_tank": 30,
	"silo":         30,

	"school":           90,
	"university":       95,
	"kindergarten":     100,
	"hospital":         200,
	"clinic":           180,
	"healthcare":       180,
	"nursing_home":     150,
	"retirement_home":  140,
	"church":           80,
	"chapel":           80,
	"place_of_worship": 80,
	"museum":           80,
	"theatre":          100,
	"cinema":           100,
	"library":          90,
	"courthouse":       90,
	"government":       90,
	"police":           90,
	"fire_station":     100,
	"community_centre": 90,
	"sports_centre":    120,
	"sports_hall":      100,
	"swimming_pool":    300,
	"fitness_centre":   100,
	"public":           85,

	"hotel":       130,
	"hostel":      120,
	"guest_house": 120,
	"motel":       120,

	"farm":           100,
	"farmhouse":      100,
	"farm_auxiliary": 60,
	"agricultural":   80,
	"greenhouse":     250,
	"stable":         80,
	"barn":           60,
	"cowshed":        80,

	"data_center":   150,
	"station":       120,
	"train_station": 120,
	"airport":       120,

	"default": 80,
}

// categoryFallbackKwhM2a is used when a normalised class is not in the table.
var categoryFallbackKwhM2a = map[category]float64{
	categoryResidential:  90,
	categoryPublic:       90,
	categoryIndustrial:   90,
	categoryAgricultural: 80,
	categoryCommercial:   80,
}

type category int

const (
	categoryCommercial category = iota
	categoryResidential
	categoryPublic
	categoryIndustrial
	categoryAgricultural
)

// Normalize lowercases an f-class, collapses separators to underscores and
// trims. It matches the normalisation the payload builder applies, so a class
// resolves the same way here and at calculation time.
func Normalize(fClass string) string {
	v := strings.ToLower(strings.TrimSpace(fClass))
	v = strings.ReplaceAll(v, "-", "_")
	v = strings.ReplaceAll(v, " ", "_")
	for strings.Contains(v, "__") {
		v = strings.ReplaceAll(v, "__", "_")
	}
	return strings.Trim(v, "_")
}

// SpecificDemandKwhM2a returns the fallback specific heat demand for an f-class:
// a direct table hit, else the class's category fallback, else the default.
func SpecificDemandKwhM2a(fClass string) float64 {
	norm := Normalize(fClass)
	if d, ok := specificDemandKwhM2a[norm]; ok {
		return d
	}
	if d, ok := categoryFallbackKwhM2a[categoryOf(norm)]; ok {
		return d
	}
	return specificDemandKwhM2a["default"]
}

// categoryOf buckets a normalised f-class. The residential branch is the one
// that matters for routing: residential buildings can go to ignis, the rest
// only to the fallback table. Non-residential categories are tested first so a
// class like "warehouse" or "farmhouse" is not caught by the "house" keyword.
func categoryOf(norm string) category {
	switch {
	case containsAny(norm, "factory", "industrial", "warehouse", "workshop", "manufacture", "sewage", "logistics", "station", "substation", "power"):
		return categoryIndustrial
	case containsAny(norm, "school", "hospital", "university", "church", "government", "community", "library", "museum", "theatre", "clinic", "healthcare"):
		return categoryPublic
	case containsAny(norm, "farm", "barn", "greenhouse", "agricultural", "stable", "cowshed"):
		return categoryAgricultural
	case containsAny(norm, "house", "apartment", "residential", "dormitory", "villa", "terrace", "townhouse", "bungalow", "sfh", "mfh", "detached"):
		return categoryResidential
	default:
		return categoryCommercial
	}
}

// IsResidential reports whether an f-class is a residential typology, i.e.
// eligible for the ignis / TABULA path. Non-residential buildings can only use
// the fallback table.
func IsResidential(fClass string) bool {
	return categoryOf(Normalize(fClass)) == categoryResidential
}

// TabulaType maps a residential f-class to a TABULA building type
// (SFH, TH, MFH, AB), or "" when the class is not confidently one of them.
// Used to build the ignis variant match once that path is wired (#50).
func TabulaType(fClass string) string {
	if !IsResidential(fClass) {
		return ""
	}
	norm := Normalize(fClass)
	switch {
	case containsAny(norm, "apartments", "apartment", "mfh", "multi_family", "block"):
		return "MFH"
	case containsAny(norm, "terrace", "townhouse", "row_house", "th", "semidetached"):
		return "TH"
	case containsAny(norm, "detached", "bungalow", "villa", "sfh", "farmhouse", "house"):
		return "SFH"
	default:
		return ""
	}
}

func containsAny(s string, subs ...string) bool {
	for _, sub := range subs {
		if strings.Contains(s, sub) {
			return true
		}
	}
	return false
}
