// Package demand holds what the resolve job and the HTTP handlers share about
// building demand series: storing a BuEM result once under its key, and
// presenting stored series as summaries and CSV.
package demand

import (
	"fmt"

	"gorm.io/datatypes"

	"spatialhub_backend/internal/buem"
	"spatialhub_backend/internal/models"
	"spatialhub_backend/internal/store/series"
)

// Saver stores a profile; satisfied by *series.Store.
type Saver interface {
	Save(p series.NewProfile) (int64, error)
}

// StoreResult stores one building's BuEM result under key and returns its
// profile id, or the reason it was not stored. A result reporting a version
// other than buemVersion is not stored.
func StoreResult(r buem.BuildingResult, key, buemVersion string, store Saver) (int64, string) {
	if r.ID == "" {
		return 0, "BuEM returned no result for this building"
	}
	parsed, err := buem.ParseResult(r)
	if err != nil {
		return 0, err.Error()
	}
	if parsed.Version != buemVersion {
		return 0, fmt.Sprintf("BuEM reports version %q, results are keyed for %q", parsed.Version, buemVersion)
	}
	data := make(map[string]series.SeriesData, len(parsed.Series))
	for name, s := range parsed.Series {
		data[name] = series.SeriesData{Unit: s.Unit, Values: s.Values}
	}
	id, err := store.Save(series.NewProfile{
		Key:               key,
		Origin:            models.SeriesOriginBuem,
		ProducerVersion:   producerVersion(parsed),
		StartTime:         parsed.StartTime,
		ResolutionMinutes: parsed.ResolutionMinutes,
		Summary:           datatypes.JSON(parsed.Summary),
		Series:            data,
	})
	if err != nil {
		return 0, fmt.Sprintf("could not store the result: %v", err)
	}
	return id, ""
}

// producerVersion is the BuEM build that computed a result: release plus
// commit when BuEM reports one.
func producerVersion(p buem.ParsedResult) string {
	if p.Commit == "" {
		return p.Version
	}
	return p.Version + "+" + p.Commit
}
