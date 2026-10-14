package buem

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const (
	testWeather  = `{"T": [1.5, 2.0], "GHI": [0, 10]}`
	testGeometry = `{"type": "Polygon", "coordinates": [[[6.0, 52.1], [6.1, 52.1], [6.1, 52.2], [6.0, 52.1]]]}`
	testBlock    = `{"building_type": "SFH", "A_ref": {"value": 120, "unit": "m2"}, "envelope": {"wall": {"U": 0.9}}}`
)

func sharedInputs(t *testing.T, weather, version string) SharedInputs {
	t.Helper()
	s, err := NewSharedInputs(json.RawMessage(weather), "1900-01-01T00:00:00Z", "1900-12-31T23:00:00Z", 60, version)
	require.NoError(t, err)
	return s
}

func building(id, block string) Building {
	return Building{ID: id, Geometry: json.RawMessage(testGeometry), Building: json.RawMessage(block)}
}

func key(t *testing.T, b Building, s SharedInputs) string {
	t.Helper()
	k, err := RequestKey(b, s)
	require.NoError(t, err)
	return k
}

func TestRequestKey_SameInputsSameKey(t *testing.T) {
	s := sharedInputs(t, testWeather, "6.9.0")
	reordered := `{"envelope": {"wall": {"U": 0.9}}, "A_ref": {"unit": "m2", "value": 120}, "building_type": "SFH"}`
	assert.Equal(t, key(t, building("268426401", testBlock), s), key(t, building("268426401", reordered), s))
}

func TestRequestKey_AnyResultInputChangesTheKey(t *testing.T) {
	base := key(t, building("268426401", testBlock), sharedInputs(t, testWeather, "6.9.0"))
	s := sharedInputs(t, testWeather, "6.9.0")
	cases := map[string]string{
		"building id": key(t, building("268426402", testBlock), s),
		"envelope":    key(t, building("268426401", `{"building_type": "SFH", "A_ref": {"value": 120, "unit": "m2"}, "envelope": {"wall": {"U": 0.3}}}`), s),
		"weather":     key(t, building("268426401", testBlock), sharedInputs(t, `{"T": [1.5, 2.5], "GHI": [0, 10]}`, "6.9.0")),
		"version":     key(t, building("268426401", testBlock), sharedInputs(t, testWeather, "6.8.0")),
	}
	withSolver := building("268426401", testBlock)
	withSolver.Solver = json.RawMessage(`{"use_milp": true}`)
	cases["solver"] = key(t, withSolver, s)
	otherPeriod, err := NewSharedInputs(json.RawMessage(testWeather), "2018-01-01T00:00:00Z", "2018-12-31T23:00:00Z", 60, "6.9.0")
	require.NoError(t, err)
	cases["period"] = key(t, building("268426401", testBlock), otherPeriod)
	otherResolution, err := NewSharedInputs(json.RawMessage(testWeather), "1900-01-01T00:00:00Z", "1900-12-31T23:00:00Z", 15, "6.9.0")
	require.NoError(t, err)
	cases["resolution"] = key(t, building("268426401", testBlock), otherResolution)

	for name, k := range cases {
		assert.NotEqual(t, base, k, "changing the %s must change the key", name)
	}
}

func TestRequestKey_DefaultComfortBandEqualsExplicitDefault(t *testing.T) {
	s := sharedInputs(t, testWeather, "6.9.0")
	explicit := `{"building_type": "SFH", "A_ref": {"value": 120, "unit": "m2"}, "envelope": {"wall": {"U": 0.9}},
		"thermal": {"comfortT_lb": {"value": 18, "unit": "degC"}, "comfortT_ub": {"value": 21, "unit": "degC"}}}`
	assert.Equal(t, key(t, building("268426401", testBlock), s), key(t, building("268426401", explicit), s))
}

func TestNewSharedInputs_DefaultResolutionEqualsSixty(t *testing.T) {
	unset, err := NewSharedInputs(json.RawMessage(testWeather), "1900-01-01T00:00:00Z", "1900-12-31T23:00:00Z", 0, "6.9.0")
	require.NoError(t, err)
	b := building("268426401", testBlock)
	assert.Equal(t, key(t, b, sharedInputs(t, testWeather, "6.9.0")), key(t, b, unset))
}

func TestRequestKey_RequiresVersion(t *testing.T) {
	_, err := NewSharedInputs(json.RawMessage(testWeather), "1900-01-01T00:00:00Z", "1900-12-31T23:00:00Z", 60, "")
	assert.Error(t, err)
	_, err = RequestKey(building("268426401", testBlock), SharedInputs{})
	assert.Error(t, err)
}
