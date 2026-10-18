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

// Surface is a roof or wall in PV orientation. Qualifies marks a roof that RoofArrays
// places an array on; Suggested marks a surface worth offering, walls included.
type Surface struct {
	Array
	Kind      string `json:"kind"`
	Qualifies bool   `json:"qualifies"`
	Suggested bool   `json:"suggested"`
}

// Surfaces returns every roof and outer wall with an area and angles. A roof qualifies
// at least 10 m2, tilt up to 60 and facing east to west, or flat; a wall never
// qualifies and is suggested at the same area and orientation.
func Surfaces(surfaces []city2tabula.Surface) []Surface {
	var out []Surface
	for _, s := range surfaces {
		if !hasShape(s) {
			continue
		}
		switch s.Type {
		case "RoofSurface":
			out = append(out, roof(s))
		case "WallSurface":
			if s.IsPartyWall == nil || !*s.IsPartyWall {
				out = append(out, wall(s))
			}
		}
	}
	return out
}

// RoofArrays returns the arrays on the qualifying roofs.
func RoofArrays(surfaces []city2tabula.Surface) []Array {
	var arrays []Array
	for _, s := range Surfaces(surfaces) {
		if s.Qualifies {
			arrays = append(arrays, s.Array)
		}
	}
	return arrays
}

func hasShape(s city2tabula.Surface) bool {
	below := s.AreaBelowPrecision != nil && *s.AreaBelowPrecision
	return s.AreaSqm != nil && s.Tilt != nil && s.Azimuth != nil && !below
}

func roof(s city2tabula.Surface) Surface {
	big := *s.AreaSqm >= minRoofAreaSqm
	// City2TABULA tilt 90 is flat; azimuth -1 marks a near-horizontal surface.
	if *s.Azimuth < 0 {
		return Surface{Array: FlatRoofArray(s.ID, *s.AreaSqm), Kind: "roof", Qualifies: big, Suggested: big}
	}
	ok := big && facesEastToWest(*s.Azimuth) && 90-*s.Tilt <= maxRoofTiltDeg
	return Surface{Array: tilted(s), Kind: "roof", Qualifies: ok, Suggested: ok}
}

func wall(s city2tabula.Surface) Surface {
	ok := *s.AreaSqm >= minRoofAreaSqm && *s.Azimuth >= 0 && facesEastToWest(*s.Azimuth)
	return Surface{Array: tilted(s), Kind: "wall", Suggested: ok}
}

func tilted(s city2tabula.Surface) Array {
	return Array{SurfaceID: s.ID, Tilt: 90 - *s.Tilt, Azimuth: *s.Azimuth, AreaSqm: *s.AreaSqm, UsableShare: DefaultUsableShare}
}

func facesEastToWest(azimuth float64) bool {
	return azimuth >= 90 && azimuth <= 270
}

// FlatRoofArray is a south-facing racked array on a flat roof.
func FlatRoofArray(surfaceID string, areaSqm float64) Array {
	return Array{
		SurfaceID: surfaceID, Tilt: flatRoofPanelTilt, Azimuth: flatRoofPanelAzimuth,
		AreaSqm: areaSqm, UsableShare: DefaultUsableShare,
	}
}
