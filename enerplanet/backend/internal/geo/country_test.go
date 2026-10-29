package geo

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestBBoxFromGeoJSON_Polygon(t *testing.T) {
	raw := json.RawMessage(`{
		"type": "Polygon",
		"coordinates": [[[8.79, 53.14], [8.82, 53.14], [8.82, 53.16], [8.79, 53.16], [8.79, 53.14]]]
	}`)

	xmin, ymin, xmax, ymax, err := BBoxFromGeoJSON(raw)
	require.NoError(t, err)
	assert.Equal(t, 8.79, xmin)
	assert.Equal(t, 53.14, ymin)
	assert.Equal(t, 8.82, xmax)
	assert.Equal(t, 53.16, ymax)
}

func TestBBoxFromGeoJSON_Point(t *testing.T) {
	raw := json.RawMessage(`{"type": "Point", "coordinates": [8.80, 53.15]}`)

	xmin, ymin, xmax, ymax, err := BBoxFromGeoJSON(raw)
	require.NoError(t, err)
	assert.Equal(t, 8.80, xmin)
	assert.Equal(t, 53.15, ymin)
	assert.Equal(t, 8.80, xmax)
	assert.Equal(t, 53.15, ymax)
}

func TestBBoxFromGeoJSON_InvalidJSON(t *testing.T) {
	_, _, _, _, err := BBoxFromGeoJSON(json.RawMessage(`not json`))
	assert.Error(t, err)
}

func TestBBoxFromGeoJSON_UnsupportedType(t *testing.T) {
	raw := json.RawMessage(`{"type": "LineString", "coordinates": [[0,0],[1,1]]}`)
	_, _, _, _, err := BBoxFromGeoJSON(raw)
	assert.Error(t, err)
}
