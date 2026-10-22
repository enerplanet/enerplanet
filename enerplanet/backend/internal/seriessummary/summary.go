// Package seriessummary turns a stored series of power per time step into what
// the frontend shows: totals, the peak and when it occurs, and daily, weekly and
// monthly energy. Full series never go to the frontend; see Window and the CSV
// download for the raw values.
package seriessummary

import (
	"fmt"
	"math"
	"strings"
	"time"
)

// Series is one stored series: power per step (Unit, for example kW or
// kW_gas) from Start, one value every ResolutionMinutes.
type Series struct {
	Start             time.Time
	ResolutionMinutes int
	Unit              string
	Values            []float32
	// Magnitude reports values by their size, for a series its producer gives
	// negative (BuEM reports cooling as negative power).
	Magnitude bool
}

// Summary is one series reduced to what the frontend displays.
type Summary struct {
	// EnergyUnit is the unit of Total, Daily, Weekly and Monthly (kWh for kW).
	EnergyUnit string    `json:"energy_unit"`
	Total      float64   `json:"total"`
	PeakUnit   string    `json:"peak_unit"`
	Peak       float64   `json:"peak"`
	PeakTime   time.Time `json:"peak_time"`
	// Daily holds one value per calendar day from Start, Monthly one per
	// calendar month. Weekly holds one per seven days from Start, the last
	// possibly shorter.
	Daily   []float64 `json:"daily"`
	Weekly  []float64 `json:"weekly"`
	Monthly []float64 `json:"monthly"`
}

// energyUnits maps a power unit to the energy unit of one hour at that power.
var energyUnits = map[string]string{"W": "Wh", "kW": "kWh", "MW": "MWh"}

// EnergyUnit returns the energy unit for a power unit, keeping a suffix such
// as _gas (kW_gas gives kWh_gas).
func EnergyUnit(powerUnit string) (string, error) {
	base, suffix, _ := strings.Cut(powerUnit, "_")
	e, ok := energyUnits[base]
	if !ok {
		return "", fmt.Errorf("power unit %q not recognised", powerUnit)
	}
	if suffix != "" {
		e += "_" + suffix
	}
	return e, nil
}

// Summarise reduces s to its Summary.
func Summarise(s Series) (Summary, error) {
	if s.ResolutionMinutes <= 0 || len(s.Values) == 0 {
		return Summary{}, fmt.Errorf("series needs a positive resolution and values, got %d minutes and %d values", s.ResolutionMinutes, len(s.Values))
	}
	energyUnit, err := EnergyUnit(s.Unit)
	if err != nil {
		return Summary{}, err
	}
	hours := float64(s.ResolutionMinutes) / 60
	out := Summary{EnergyUnit: energyUnit, PeakUnit: s.Unit, Peak: math.Inf(-1)}
	start := s.Start.UTC()
	firstDay := time.Date(start.Year(), start.Month(), start.Day(), 0, 0, 0, 0, time.UTC)
	for i, v := range s.Values {
		power := float64(s.value(v))
		at := start.Add(time.Duration(i*s.ResolutionMinutes) * time.Minute)
		if power > out.Peak {
			out.Peak, out.PeakTime = power, at
		}
		energy := power * hours
		out.Total += energy
		day := int(at.Sub(firstDay).Hours() / 24)
		out.Daily = addAt(out.Daily, day, energy)
		out.Weekly = addAt(out.Weekly, day/7, energy)
		month := (at.Year()-start.Year())*12 + int(at.Month()) - int(start.Month())
		out.Monthly = addAt(out.Monthly, month, energy)
	}
	return out, nil
}

// addAt adds v at index i, growing values with zeros as needed.
func addAt(values []float64, i int, v float64) []float64 {
	for len(values) <= i {
		values = append(values, 0)
	}
	values[i] += v
	return values
}

// Window returns the power values of week (0 for the first seven days from
// Start), by magnitude when s.Magnitude is set.
func Window(s Series, week int) ([]float32, error) {
	if s.ResolutionMinutes <= 0 {
		return nil, fmt.Errorf("series needs a positive resolution, got %d minutes", s.ResolutionMinutes)
	}
	perWeek := 7 * 24 * 60 / s.ResolutionMinutes
	from := week * perWeek
	if week < 0 || from >= len(s.Values) {
		return nil, fmt.Errorf("week %d is outside the series (%d weeks)", week, (len(s.Values)+perWeek-1)/perWeek)
	}
	window := s.Values[from:min(from+perWeek, len(s.Values))]
	out := make([]float32, len(window))
	for i, v := range window {
		out[i] = s.value(v)
	}
	return out, nil
}

// value applies the magnitude rule to one stored value.
func (s Series) value(v float32) float32 {
	if s.Magnitude && v < 0 {
		return -v
	}
	return v
}
