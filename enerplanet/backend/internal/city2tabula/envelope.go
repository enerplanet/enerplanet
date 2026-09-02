package city2tabula

// Quantity is a value with its unit, matching how buem-gateway shapes every
// measurement in the envelope_element schema.
type Quantity struct {
	Value float64 `json:"value" example:"30"`
	Unit  string  `json:"unit" example:"m2"`
}

// EnvelopeElement is one BuEM envelope element derived from a City2TABULA
// surface. id carries the City2TABULA surface id unchanged so a caller can map
// a rendered surface back to the element being edited.
type EnvelopeElement struct {
	ID      string   `json:"id" example:"w1"`
	Type    string   `json:"type" example:"wall"`
	Area    Quantity `json:"area"`
	Azimuth Quantity `json:"azimuth"`
	Tilt    Quantity `json:"tilt"`
}

// envelopeTypeByClassname maps City2TABULA's CityGML surface classnames onto
// BuEM's envelope_element "type" vocabulary (buem-gateway request_schema.json,
// schema v5). A classname with no entry (e.g. ClosureSurface) is skipped rather
// than guessed.
var envelopeTypeByClassname = map[string]string{
	"WallSurface":   "wall",
	"RoofSurface":   "roof",
	"GroundSurface": "floor",
}

// EnvelopeElements builds BuEM's envelope_element list from a building's
// City2TABULA surface attributes (area, azimuth, tilt per surface). BuEM needs
// only these attributes, never the surface polygons. A surface is left out
// only when its type has no BuEM mapping or its area, azimuth or tilt is
// missing: BuEM's schema requires all three on every element. The IsValid and
// IsPlanar flags are not a gate (see Surface): on real LOD2 data they are
// false for nearly every wall and roof while the area and angle are still
// correct, so gating on them left envelopes with a floor and nothing else.
//
// Filtering here does not affect 3D rendering. The surface polygons for
// visualisation are a separate, unfiltered City2TABULA response
// (GET /api/v1/geometry); a surface dropped here still renders, it just has no
// element to edit. Each element's id is the City2TABULA surface id unchanged,
// so a caller can match a rendered surface to its element.
//
// Shared by the run_buem job and the enrich HTTP handler so the two paths
// produce identical envelope blocks. Returns nil when no surface qualifies.
func EnvelopeElements(building Building) []EnvelopeElement {
	var elements []EnvelopeElement
	for _, s := range building.Surfaces {
		elemType, ok := envelopeTypeByClassname[s.Type]
		if !ok {
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

		elements = append(elements, EnvelopeElement{
			ID:      s.ID,
			Type:    elemType,
			Area:    Quantity{Value: *s.AreaSqm, Unit: "m2"},
			Azimuth: Quantity{Value: azimuth, Unit: "deg"},
			// City2TABULA: 0=vertical wall, 90=flat roof — the opposite of
			// BuEM's 0=horizontal roof, 90=vertical wall.
			Tilt: Quantity{Value: 90 - *s.Tilt, Unit: "deg"},
		})
	}
	return elements
}
