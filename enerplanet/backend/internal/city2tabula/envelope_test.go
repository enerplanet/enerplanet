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
		want    map[string]interface{} // nil = surface expected to be dropped
	}{
		{
			name:    "wall surface maps and inverts tilt",
			surface: Surface{ID: "w1", Type: "WallSurface", AreaSqm: ptrF(30), Azimuth: ptrF(180), Tilt: ptrF(0)},
			want: map[string]interface{}{
				"id":      "w1",
				"type":    "wall",
				"area":    map[string]interface{}{"value": 30.0, "unit": "m2"},
				"azimuth": map[string]interface{}{"value": 180.0, "unit": "deg"},
				"tilt":    map[string]interface{}{"value": 90.0, "unit": "deg"},
			},
		},
		{
			name:    "roof surface, flat roof tilt 90 becomes 0",
			surface: Surface{ID: "r1", Type: "RoofSurface", AreaSqm: ptrF(62), Azimuth: ptrF(-1), Tilt: ptrF(90)},
			want: map[string]interface{}{
				"id":      "r1",
				"type":    "roof",
				"area":    map[string]interface{}{"value": 62.0, "unit": "m2"},
				"azimuth": map[string]interface{}{"value": 0.0, "unit": "deg"},
				"tilt":    map[string]interface{}{"value": 0.0, "unit": "deg"},
			},
		},
		{
			name:    "ground surface maps to floor",
			surface: Surface{ID: "g1", Type: "GroundSurface", AreaSqm: ptrF(80), Azimuth: ptrF(-1), Tilt: ptrF(90)},
			want: map[string]interface{}{
				"id":      "g1",
				"type":    "floor",
				"area":    map[string]interface{}{"value": 80.0, "unit": "m2"},
				"azimuth": map[string]interface{}{"value": 0.0, "unit": "deg"},
				"tilt":    map[string]interface{}{"value": 0.0, "unit": "deg"},
			},
		},
		{
			name:    "unmapped classname is dropped",
			surface: Surface{ID: "c1", Type: "ClosureSurface", AreaSqm: ptrF(5), Azimuth: ptrF(0), Tilt: ptrF(0)},
			want:    nil,
		},
		{
			name:    "invalid surface is dropped",
			surface: Surface{ID: "w2", Type: "WallSurface", AreaSqm: ptrF(30), Azimuth: ptrF(0), Tilt: ptrF(0), IsValid: ptrB(false)},
			want:    nil,
		},
		{
			name:    "non-planar surface is dropped",
			surface: Surface{ID: "w3", Type: "WallSurface", AreaSqm: ptrF(30), Azimuth: ptrF(0), Tilt: ptrF(0), IsPlanar: ptrB(false)},
			want:    nil,
		},
		{
			name:    "missing area is dropped",
			surface: Surface{ID: "w4", Type: "WallSurface", Azimuth: ptrF(0), Tilt: ptrF(0)},
			want:    nil,
		},
		{
			name:    "missing azimuth is dropped",
			surface: Surface{ID: "w5", Type: "WallSurface", AreaSqm: ptrF(30), Tilt: ptrF(0)},
			want:    nil,
		},
		{
			name:    "missing tilt is dropped",
			surface: Surface{ID: "w6", Type: "WallSurface", AreaSqm: ptrF(30), Azimuth: ptrF(0)},
			want:    nil,
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
			assert.Equal(t, tt.want, got[0])
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
	assert.Equal(t, "w1", got[0]["id"])
	assert.Equal(t, "r1", got[1]["id"])
}
