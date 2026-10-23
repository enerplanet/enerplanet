package pv

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSnapLocation_buildingsOfOneCellShareIt(t *testing.T) {
	a := SnapLocation(Location{Lat: 48.8301, Lon: 12.9555})
	b := SnapLocation(Location{Lat: 48.8399, Lon: 12.9999})

	assert.Equal(t, Location{Lat: 48.825, Lon: 12.975}, a)
	assert.Equal(t, a, b)
	assert.NotEqual(t, a, SnapLocation(Location{Lat: 48.8501, Lon: 12.9555}))
}

func TestRequestKey_sharedAcrossModelsChangedByInputs(t *testing.T) {
	wx := json.RawMessage(`{"index":[0],"variables":{"T":[1]}}`)
	loc := SnapLocation(Location{Lat: 48.83, Lon: 12.96})
	s, err := NewSharedInputs(wx, loc, "2018-01-01", "2018-12-31", 60, "1.0.0")
	require.NoError(t, err)
	req := ArrayRequest{ID: "way1/0", Tilt: 30, Azimuth: 180, Losses: 0.14, DCACRatio: 1.1, InverterEfficiency: 0.96, ModuleType: "standard"}

	key, err := RequestKey("roof-1", req, s)
	require.NoError(t, err)

	other := req
	other.ID = "way2/3"
	same, _ := RequestKey("roof-1", other, s)
	assert.Equal(t, key, same, "the request id names a model's building and must not change the key")

	tilted := req
	tilted.Tilt = 35
	changed, _ := RequestKey("roof-1", tilted, s)
	assert.NotEqual(t, key, changed)

	newer, err := NewSharedInputs(wx, loc, "2018-01-01", "2018-12-31", 60, "1.1.0")
	require.NoError(t, err)
	versioned, _ := RequestKey("roof-1", req, newer)
	assert.NotEqual(t, key, versioned, "a new PV service version must not reuse old profiles")

	_, err = NewSharedInputs(wx, loc, "2018-01-01", "2018-12-31", 60, "")
	assert.Error(t, err, "without a version a changed PV service would reuse old profiles")
}

func TestResample(t *testing.T) {
	hourly := []float64{0.2, 0.4, 0.6, 0.8}

	assert.Equal(t, []float32{0.2, 0.4, 0.6, 0.8}, Resample(hourly, 60))
	assert.Equal(t, []float32{0.2, 0.2, 0.4, 0.4, 0.6, 0.6, 0.8, 0.8}, Resample(hourly, 30))
	assert.InDeltaSlice(t, []float32{0.3, 0.7}, Resample(hourly, 120), 1e-6)
	assert.InDeltaSlice(t, []float32{0.4}, Resample(hourly[:3], 180), 1e-6)
}
