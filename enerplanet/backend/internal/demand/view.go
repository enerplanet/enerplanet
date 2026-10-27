package demand

import (
	"archive/zip"
	"fmt"
	"io"

	"spatialhub_backend/internal/api/contracts"
	"spatialhub_backend/internal/seriessummary"
	seriesstore "spatialhub_backend/internal/store/series"
)

// ToSeries converts a stored series; cooling is reported by magnitude,
// since BuEM gives it as negative power.
func ToSeries(ls seriesstore.LinkedSeries) seriessummary.Series {
	return seriessummary.Series{
		Start: ls.StartTime, ResolutionMinutes: ls.ResolutionMinutes, Unit: ls.Unit,
		Values: ls.Vals, Magnitude: ls.Series == "cooling",
	}
}

// Summaries summarises every linked series.
func Summaries(linked []seriesstore.LinkedSeries) ([]contracts.SeriesSummary, error) {
	out := make([]contracts.SeriesSummary, 0, len(linked))
	for _, ls := range linked {
		summary, err := seriessummary.Summarise(ToSeries(ls))
		if err != nil {
			return nil, fmt.Errorf("series %s of building %s: %w", ls.Series, ls.BuildingRef, err)
		}
		version := ""
		if ls.ProducerVersion != nil {
			version = *ls.ProducerVersion
		}
		out = append(out, contracts.SeriesSummary{
			Name: ls.Series, Part: ls.Part, Source: ls.Source, ProducerVersion: version,
			Start: ls.StartTime.UTC(), ResolutionMinutes: ls.ResolutionMinutes, Summary: summary,
		})
	}
	return out, nil
}

// FindSeries returns the series with name and part.
func FindSeries(linked []seriesstore.LinkedSeries, name, part string) (seriesstore.LinkedSeries, bool) {
	for _, ls := range linked {
		if ls.Series == name && ls.Part == part {
			return ls, true
		}
	}
	return seriesstore.LinkedSeries{}, false
}

// WriteBuildingCSV writes one building's series as CSV; a roof-face series is
// named "<series>:<part>".
func WriteBuildingCSV(w io.Writer, linked []seriesstore.LinkedSeries) error {
	byName := make(map[string]seriessummary.Series, len(linked))
	for _, ls := range linked {
		name := ls.Series
		if ls.Part != "" {
			name += ":" + ls.Part
		}
		byName[name] = ToSeries(ls)
	}
	return seriessummary.WriteCSV(w, byName)
}

// WriteModelZip writes one CSV per building into a ZIP; linked is ordered by
// building.
func WriteModelZip(w io.Writer, modelID uint, linked []seriesstore.LinkedSeries) error {
	zw := zip.NewWriter(w)
	for start := 0; start < len(linked); {
		end := start
		for end < len(linked) && linked[end].BuildingRef == linked[start].BuildingRef {
			end++
		}
		f, err := zw.Create(fmt.Sprintf("model-%d-%s.csv", modelID, linked[start].BuildingRef))
		if err != nil {
			return err
		}
		if err := WriteBuildingCSV(f, linked[start:end]); err != nil {
			return fmt.Errorf("building %s: %w", linked[start].BuildingRef, err)
		}
		start = end
	}
	return zw.Close()
}
