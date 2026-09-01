package city2tabula

// envelopeTypeByClassname maps City2TABULA's CityGML surface classnames onto
// BuEM's envelope_element "type" vocabulary (buem-gateway request_schema.json,
// schema v5). A classname with no entry (e.g. ClosureSurface) is skipped rather
// than guessed.
var envelopeTypeByClassname = map[string]string{
	"WallSurface":   "wall",
	"RoofSurface":   "roof",
	"GroundSurface": "floor",
}

// EnvelopeElements maps a building's City2TABULA per-surface geometry onto BuEM's
// envelope_element schema. Surfaces with an unmapped type, or that City2TABULA
// flagged invalid or non-planar, or missing area/azimuth/tilt, are left out
// rather than sent with placeholder geometry.
//
// Shared by the run_buem job and the enrich HTTP handler so the two paths
// produce identical envelope blocks. Returns nil when no surface qualifies.
func EnvelopeElements(building Building) []map[string]interface{} {
	var elements []map[string]interface{}
	for _, s := range building.Surfaces {
		elemType, ok := envelopeTypeByClassname[s.Type]
		if !ok {
			continue
		}
		if s.IsValid != nil && !*s.IsValid {
			continue
		}
		if s.IsPlanar != nil && !*s.IsPlanar {
			continue
		}
		if s.AreaSqm == nil || s.Azimuth == nil || s.Tilt == nil {
			continue
		}

		azimuth := *s.Azimuth
		if azimuth < 0 {
			// City2TABULA uses -1 for near-horizontal surfaces with no
			// meaningful orientation; BuEM's schema requires [0,360], so
			// undefined becomes 0 (non-directional) rather than -1.
			azimuth = 0
		}

		elements = append(elements, map[string]interface{}{
			"id":      s.ID,
			"type":    elemType,
			"area":    map[string]interface{}{"value": *s.AreaSqm, "unit": "m2"},
			"azimuth": map[string]interface{}{"value": azimuth, "unit": "deg"},
			// City2TABULA: 0=vertical wall, 90=flat roof — the opposite of
			// BuEM's 0=horizontal roof, 90=vertical wall.
			"tilt": map[string]interface{}{"value": 90 - *s.Tilt, "unit": "deg"},
		})
	}
	return elements
}
