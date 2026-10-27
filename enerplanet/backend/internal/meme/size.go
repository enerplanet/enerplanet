package meme

import (
	"encoding/json"
	"fmt"
	"math"
)

// Peak memory of a Calliope 0.7 plan solve with CBC, fitted to two measured
// runs of hourly full-year jobs: 29 combinations used 2.5 GB, 115 used 7.96 GB.
// Other technologies, MILP features or operate mode may need more.
const (
	baseMemoryMB           = 660
	memoryPerCombinationMB = 63.5
	hoursPerYear           = 8760
)

// Size is a MEME job's solve size: the node:tech:carrier combinations Calliope
// builds from it, its timesteps, and the estimated peak memory of the solve.
type Size struct {
	Combinations int
	Timesteps    int
	MemoryMB     int
}

type sizedJob struct {
	Model struct {
		Technologies map[string]struct {
			Role string `json:"role"`
		} `json:"technologies"`
		Transmission map[string]json.RawMessage `json:"transmission"`
		Trade        map[string]struct {
			Import json.RawMessage `json:"import"`
			Export json.RawMessage `json:"export"`
		} `json:"trade"`
		Timeseries map[string]struct {
			Values []json.RawMessage `json:"values"`
		} `json:"timeseries"`
	} `json:"model"`
}

// EstimateSize counts the combinations the way Calliope reports them in its
// "valid node:tech:carrier combinations" log line: one per technology, two for
// a conversion (its input and output carrier), two per line (one per end), and
// one per import and per export of a trade. Timesteps are the longest series,
// since MEME sizes the calendar from it.
func EstimateSize(job []byte) (Size, error) {
	var j sizedJob
	if err := json.Unmarshal(job, &j); err != nil {
		return Size{}, fmt.Errorf("meme: read job for its size: %w", err)
	}
	var s Size
	for _, t := range j.Model.Technologies {
		if t.Role == "conversion" {
			s.Combinations += 2
		} else {
			s.Combinations++
		}
	}
	s.Combinations += 2 * len(j.Model.Transmission)
	for _, tr := range j.Model.Trade {
		if len(tr.Import) > 0 {
			s.Combinations++
		}
		if len(tr.Export) > 0 {
			s.Combinations++
		}
	}
	for _, ts := range j.Model.Timeseries {
		s.Timesteps = max(s.Timesteps, len(ts.Values))
	}
	scale := float64(s.Timesteps) / hoursPerYear
	s.MemoryMB = int(math.Round(baseMemoryMB + memoryPerCombinationMB*float64(s.Combinations)*scale))
	return s, nil
}
