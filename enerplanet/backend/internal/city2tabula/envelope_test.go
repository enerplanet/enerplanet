package city2tabula

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func ptrF(v float64) *float64 { return &v }
func ptrB(v bool) *bool       { return &v }

func TestEnvelopeElements(t *testing.T) {
	tests := []struct {
		name    string
		surface Surface
		want    *EnvelopeElement // nil = surface expected to be dropped
	}{
		{
			name:    "wall surface maps and inverts tilt",
			surface: Surface{ID: "w1", Type: "WallSurface", AreaSqm: ptrF(30), Azimuth: ptrF(180), Tilt: ptrF(0)},
			want: &EnvelopeElement{
				ID: "w1", Type: "wall",
				Area:    Quantity{Value: 30, Unit: "m2"},
				Azimuth: Quantity{Value: 180, Unit: "deg"},
				Tilt:    Quantity{Value: 90, Unit: "deg"}, // c2t 0=wall -> BuEM 90=wall
			},
		},
		{
			name:    "roof surface, flat roof tilt 90 becomes 0, undefined azimuth clamps to 0",
			surface: Surface{ID: "r1", Type: "RoofSurface", AreaSqm: ptrF(62), Azimuth: ptrF(-1), Tilt: ptrF(90)},
			want: &EnvelopeElement{
				ID: "r1", Type: "roof",
				Area:    Quantity{Value: 62, Unit: "m2"},
				Azimuth: Quantity{Value: 0, Unit: "deg"},
				Tilt:    Quantity{Value: 0, Unit: "deg"},
			},
		},
		{
			name:    "ground surface maps to floor",
			surface: Surface{ID: "g1", Type: "GroundSurface", AreaSqm: ptrF(80), Azimuth: ptrF(-1), Tilt: ptrF(90)},
			want: &EnvelopeElement{
				ID: "g1", Type: "floor",
				Area:    Quantity{Value: 80, Unit: "m2"},
				Azimuth: Quantity{Value: 0, Unit: "deg"},
				Tilt:    Quantity{Value: 0, Unit: "deg"},
			},
		},
		{
			name:    "unmapped classname is dropped",
			surface: Surface{ID: "c1", Type: "ClosureSurface", AreaSqm: ptrF(5), Azimuth: ptrF(0), Tilt: ptrF(0)},
		},
		{
			name:    "invalid surface is dropped",
			surface: Surface{ID: "w2", Type: "WallSurface", AreaSqm: ptrF(30), Azimuth: ptrF(0), Tilt: ptrF(0), IsValid: ptrB(false)},
		},
		{
			name:    "non-planar surface is dropped",
			surface: Surface{ID: "w3", Type: "WallSurface", AreaSqm: ptrF(30), Azimuth: ptrF(0), Tilt: ptrF(0), IsPlanar: ptrB(false)},
		},
		{
			name:    "missing area is dropped",
			surface: Surface{ID: "w4", Type: "WallSurface", Azimuth: ptrF(0), Tilt: ptrF(0)},
		},
		{
			name:    "missing azimuth is dropped",
			surface: Surface{ID: "w5", Type: "WallSurface", AreaSqm: ptrF(30), Tilt: ptrF(0)},
		},
		{
			name:    "missing tilt is dropped",
			surface: Surface{ID: "w6", Type: "WallSurface", AreaSqm: ptrF(30), Azimuth: ptrF(0)},
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := EnvelopeElements(Building{Surfaces: []Surface{tt.surface}})
			if tt.want == nil {
				assert.Empty(t, got)
				return
			}
			require.Len(t, got, 1)
			assert.Equal(t, *tt.want, got[0])
		})
	}
}

func TestEnvelopeElements_MultipleSurfaces(t *testing.T) {
	b := Building{Surfaces: []Surface{
		{ID: "w1", Type: "WallSurface", AreaSqm: ptrF(30), Azimuth: ptrF(0), Tilt: ptrF(0)},
		{ID: "x1", Type: "ClosureSurface", AreaSqm: ptrF(1), Azimuth: ptrF(0), Tilt: ptrF(0)},
		{ID: "r1", Type: "RoofSurface", AreaSqm: ptrF(50), Azimuth: ptrF(-1), Tilt: ptrF(90)},
	}}
	got := EnvelopeElements(b)
	require.Len(t, got, 2)
	assert.Equal(t, "w1", got[0].ID)
	assert.Equal(t, "r1", got[1].ID)
}
