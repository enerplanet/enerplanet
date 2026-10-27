package seriessummary

import (
	"encoding/csv"
	"fmt"
	"io"
	"maps"
	"slices"
	"strconv"
	"time"
)

// WriteCSV writes series side by side, one row per time step: a UTC timestamp
// column, then one column per series named "<name> [<unit>]", in name order.
// Every series must share start, resolution and length.
func WriteCSV(w io.Writer, series map[string]Series) error {
	names := slices.Sorted(maps.Keys(series))
	if len(names) == 0 {
		return fmt.Errorf("no series to write")
	}
	first := series[names[0]]
	header := []string{"timestamp"}
	for _, name := range names {
		s := series[name]
		if !s.Start.Equal(first.Start) || s.ResolutionMinutes != first.ResolutionMinutes || len(s.Values) != len(first.Values) {
			return fmt.Errorf("series %s does not share start, resolution and length with %s", name, names[0])
		}
		header = append(header, fmt.Sprintf("%s [%s]", name, s.Unit))
	}
	out := csv.NewWriter(w)
	if err := out.Write(header); err != nil {
		return err
	}
	row := make([]string, len(header))
	for i := range first.Values {
		row[0] = first.Start.UTC().Add(time.Duration(i*first.ResolutionMinutes) * time.Minute).Format(time.RFC3339)
		for j, name := range names {
			s := series[name]
			row[j+1] = strconv.FormatFloat(float64(s.value(s.Values[i])), 'f', -1, 32)
		}
		if err := out.Write(row); err != nil {
			return err
		}
	}
	out.Flush()
	return out.Error()
}
