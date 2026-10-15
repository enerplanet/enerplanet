package seriessummary

import (
	"bytes"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

var start1900 = time.Date(1900, 1, 1, 0, 0, 0, 0, time.UTC)

func constantYear(power float32) []float32 {
	v := make([]float32, 8760)
	for i := range v {
		v[i] = power
	}
	return v
}

func TestSummarise_HourlyYear(t *testing.T) {
	values := constantYear(1)
	values[24*40+18] = 5 // 10 February, 18:00
	got, err := Summarise(Series{Start: start1900, ResolutionMinutes: 60, Unit: "kW", Values: values})
	require.NoError(t, err)

	assert.Equal(t, "kWh", got.EnergyUnit)
	assert.InDelta(t, 8764, got.Total, 1e-6)
	assert.Equal(t, 5.0, got.Peak)
	assert.Equal(t, time.Date(1900, 2, 10, 18, 0, 0, 0, time.UTC), got.PeakTime)
	require.Len(t, got.Daily, 365)
	assert.Equal(t, 24.0, got.Daily[0])
	require.Len(t, got.Weekly, 53, "52 full weeks and one day")
	assert.Equal(t, 168.0, got.Weekly[0])
	assert.Equal(t, 24.0, got.Weekly[52])
	require.Len(t, got.Monthly, 12)
	assert.Equal(t, 744.0, got.Monthly[0])
	assert.Equal(t, 672.0+4, got.Monthly[1], "February 1900 has 28 days, plus the peak's extra 4 kWh")
}

func TestSummarise_UnitsResolutionAndMagnitude(t *testing.T) {
	cooling, err := Summarise(Series{Start: start1900, ResolutionMinutes: 15, Unit: "kW", Values: []float32{-2, -4, 0, 0}, Magnitude: true})
	require.NoError(t, err)
	assert.InDelta(t, 1.5, cooling.Total, 1e-9, "15-minute steps: (2+4)/4 kWh")
	assert.Equal(t, 4.0, cooling.Peak)

	gas, err := Summarise(Series{Start: start1900, ResolutionMinutes: 60, Unit: "kW_gas", Values: []float32{1}})
	require.NoError(t, err)
	assert.Equal(t, "kWh_gas", gas.EnergyUnit)

	_, err = Summarise(Series{Start: start1900, ResolutionMinutes: 60, Unit: "hp", Values: []float32{1}})
	assert.Error(t, err)
	_, err = Summarise(Series{Start: start1900, ResolutionMinutes: 60, Unit: "kW"})
	assert.Error(t, err)
}

func TestWindow(t *testing.T) {
	s := Series{Start: start1900, ResolutionMinutes: 60, Unit: "kW", Values: constantYear(-1), Magnitude: true}
	first, err := Window(s, 0)
	require.NoError(t, err)
	assert.Len(t, first, 168)
	assert.Equal(t, float32(1), first[0], "magnitude applied")

	last, err := Window(s, 52)
	require.NoError(t, err)
	assert.Len(t, last, 24)

	_, err = Window(s, 53)
	assert.Error(t, err)
	_, err = Window(s, -1)
	assert.Error(t, err)
}

func TestWriteCSV(t *testing.T) {
	var buf bytes.Buffer
	err := WriteCSV(&buf, map[string]Series{
		"heating": {Start: start1900, ResolutionMinutes: 60, Unit: "kW", Values: []float32{1.5, 2}},
		"cooling": {Start: start1900, ResolutionMinutes: 60, Unit: "kW", Values: []float32{-0.5, 0}, Magnitude: true},
	})
	require.NoError(t, err)
	assert.Equal(t, strings.Join([]string{
		"timestamp,cooling [kW],heating [kW]",
		"1900-01-01T00:00:00Z,0.5,1.5",
		"1900-01-01T01:00:00Z,0,2",
		"",
	}, "\n"), buf.String())

	err = WriteCSV(&bytes.Buffer{}, map[string]Series{
		"a": {Start: start1900, ResolutionMinutes: 60, Unit: "kW", Values: []float32{1}},
		"b": {Start: start1900, ResolutionMinutes: 60, Unit: "kW", Values: []float32{1, 2}},
	})
	assert.Error(t, err)
}
