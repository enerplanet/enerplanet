package pv

import "spatialhub_backend/internal/city2tabula"

const (
	// KWPerSqm matches the building configurator's PV model.
	KWPerSqm             = 0.2
	DefaultUsableShare   = 0.8
	minRoofAreaSqm       = 10
	maxRoofTiltDeg       = 60
	flatRoofPanelTilt    = 15
	flatRoofPanelAzimuth = 180
)

// Array is one PV array on a surface; tilt from horizontal, azimuth clockwise from north. CapacityKW fixes its size.
type Array struct {
	SurfaceID   string   `json:"surface_id"`
	Tilt        float64  `json:"tilt"`
	Azimuth     float64  `json:"azimuth"`
	AreaSqm     float64  `json:"area"`
	UsableShare float64  `json:"usable_share"`
	CapacityKW  *float64 `json:"capacity_kw,omitempty"`
}

// MaxCapacityKW is the capacity of modules on the usable area.
func (a Array) MaxCapacityKW() float64 {
	return a.AreaSqm * a.UsableShare * KWPerSqm
}

// RoofArrays places an array on every roof of at least 10 m2, tilt up to 60 and facing east to west; flat roofs always.
func RoofArrays(surfaces []city2tabula.Surface) []Array {
	var arrays []Array
	for _, s := range surfaces {
		if a, ok := roofArray(s); ok {
			arrays = append(arrays, a)
		}
	}
	return arrays
}

func roofArray(s city2tabula.Surface) (Array, bool) {
	if s.Type != "RoofSurface" || s.AreaSqm == nil || s.Tilt == nil || s.Azimuth == nil {
		return Array{}, false
	}
	if *s.AreaSqm < minRoofAreaSqm || (s.AreaBelowPrecision != nil && *s.AreaBelowPrecision) {
		return Array{}, false
	}
	// City2TABULA tilt 90 is flat; azimuth -1 marks a near-horizontal surface.
	if *s.Azimuth < 0 {
		return FlatRoofArray(s.ID, *s.AreaSqm), true
	}
	tilt := 90 - *s.Tilt
	if tilt > maxRoofTiltDeg || *s.Azimuth < 90 || *s.Azimuth > 270 {
		return Array{}, false
	}
	return Array{SurfaceID: s.ID, Tilt: tilt, Azimuth: *s.Azimuth, AreaSqm: *s.AreaSqm, UsableShare: DefaultUsableShare}, true
}

// FlatRoofArray is a south-facing racked array on a flat roof.
func FlatRoofArray(surfaceID string, areaSqm float64) Array {
	return Array{
		SurfaceID: surfaceID, Tilt: flatRoofPanelTilt, Azimuth: flatRoofPanelAzimuth,
		AreaSqm: areaSqm, UsableShare: DefaultUsableShare,
	}
}
