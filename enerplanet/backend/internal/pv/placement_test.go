package pv

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"spatialhub_backend/internal/city2tabula"
)

func surface(id, typ string, area, c2tTilt, azimuth float64) city2tabula.Surface {
	return city2tabula.Surface{ID: id, Type: typ, AreaSqm: &area, Tilt: &c2tTilt, Azimuth: &azimuth}
}

func TestRoofArraysPicksQualifyingRoofs(t *testing.T) {
	tiny := true
	sliver := surface("sliver", "RoofSurface", 30, 55, 180)
	sliver.AreaBelowPrecision = &tiny
	arrays := RoofArrays([]city2tabula.Surface{
		surface("south", "RoofSurface", 40, 55, 180), // 35 degrees from horizontal
		surface("east", "RoofSurface", 40, 55, 90),
		surface("west", "RoofSurface", 40, 55, 270),
		surface("north", "RoofSurface", 40, 55, 0),
		surface("north-east", "RoofSurface", 40, 55, 60),
		surface("steep", "RoofSurface", 40, 20, 180), // 70 degrees
		surface("small", "RoofSurface", 9.9, 55, 180),
		surface("flat", "RoofSurface", 120, 90, -1),
		surface("wall", "WallSurface", 80, 0, 180),
		sliver,
	})

	ids := make([]string, len(arrays))
	for i, a := range arrays {
		ids[i] = a.SurfaceID
	}
	assert.Equal(t, []string{"south", "east", "west", "flat"}, ids)
	assert.Equal(t, Array{SurfaceID: "south", Tilt: 35, Azimuth: 180, AreaSqm: 40, UsableShare: 0.8}, arrays[0])
	assert.Equal(t, Array{SurfaceID: "flat", Tilt: 15, Azimuth: 180, AreaSqm: 120, UsableShare: 0.8}, arrays[3])
}

func TestMaxCapacityKW(t *testing.T) {
	assert.InDelta(t, 6.4, Array{AreaSqm: 40, UsableShare: 0.8}.MaxCapacityKW(), 1e-9)
}

func TestRoofsMarksWhichQualify(t *testing.T) {
	roofs := Roofs([]city2tabula.Surface{
		surface("south", "RoofSurface", 40, 55, 180),
		surface("north", "RoofSurface", 40, 55, 0),
		surface("wall", "WallSurface", 80, 0, 180),
	})

	assert.Equal(t, []Roof{
		{Array: Array{SurfaceID: "south", Tilt: 35, Azimuth: 180, AreaSqm: 40, UsableShare: 0.8}, Qualifies: true},
		{Array: Array{SurfaceID: "north", Tilt: 35, Azimuth: 0, AreaSqm: 40, UsableShare: 0.8}, Qualifies: false},
	}, roofs)
}
