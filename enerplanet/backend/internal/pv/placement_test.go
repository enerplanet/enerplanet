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

func TestSurfacesOffersRoofsAndWalls(t *testing.T) {
	shared := true
	party := surface("party", "WallSurface", 60, 0, 180)
	party.IsPartyWall = &shared
	got := Surfaces([]city2tabula.Surface{
		surface("south", "RoofSurface", 40, 55, 180),
		surface("north", "RoofSurface", 40, 55, 0),
		surface("wall-s", "WallSurface", 80, 0, 180),
		surface("wall-n", "WallSurface", 80, 0, 0),
		surface("wall-small", "WallSurface", 6, 0, 200),
		party,
		surface("ground", "GroundSurface", 90, 90, -1),
	})

	assert.Equal(t, []Surface{
		{Array: Array{SurfaceID: "south", Tilt: 35, Azimuth: 180, AreaSqm: 40, UsableShare: 0.8}, Kind: "roof", Qualifies: true, Suggested: true},
		{Array: Array{SurfaceID: "north", Tilt: 35, Azimuth: 0, AreaSqm: 40, UsableShare: 0.8}, Kind: "roof"},
		{Array: Array{SurfaceID: "wall-s", Tilt: 90, Azimuth: 180, AreaSqm: 80, UsableShare: 0.8}, Kind: "wall", Suggested: true},
		{Array: Array{SurfaceID: "wall-n", Tilt: 90, Azimuth: 0, AreaSqm: 80, UsableShare: 0.8}, Kind: "wall"},
		{Array: Array{SurfaceID: "wall-small", Tilt: 90, Azimuth: 200, AreaSqm: 6, UsableShare: 0.8}, Kind: "wall"},
	}, got)
}
