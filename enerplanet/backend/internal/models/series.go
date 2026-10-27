package models

import (
	"time"

	"github.com/lib/pq"
	"gorm.io/datatypes"
)

// Series profile origins: who produced a profile's series.
const (
	SeriesOriginBuem     = "buem"
	SeriesOriginPV       = "pv"
	SeriesOriginUploaded = "uploaded"
)

// Series link sources: where a building's series came from in one draft or
// model. default and user are generated (from default or customised
// parameters), uploaded is the user's own file.
const (
	SeriesSourceDefault  = "default"
	SeriesSourceUser     = "user"
	SeriesSourceUploaded = "uploaded"
)

// SeriesProfile is one stored result: the series of one building (BuEM) or
// one roof face (PV), or an uploaded file, stored once under Key. A generated
// profile has no owner and is shared; an uploaded one has OwnerUserID set.
type SeriesProfile struct {
	ID                int64          `gorm:"primaryKey"`
	Key               string         `gorm:"size:64;not null"`
	Origin            string         `gorm:"size:16;not null"`
	OwnerUserID       *string        `gorm:"size:255"`
	ProducerVersion   *string        `gorm:"size:255"`
	StartTime         time.Time      `gorm:"not null"`
	ResolutionMinutes int            `gorm:"not null"`
	Summary           datatypes.JSON `gorm:"type:jsonb"`
	CreatedAt         time.Time
}

// TableName pins the table name to the migration's.
func (SeriesProfile) TableName() string { return "series_profiles" }

// SeriesValues is one series of a profile, as energy per step in Unit.
type SeriesValues struct {
	ProfileID int64           `gorm:"primaryKey"`
	Series    string          `gorm:"primaryKey;size:32"`
	Unit      string          `gorm:"size:16;not null"`
	Vals      pq.Float32Array `gorm:"type:real[];not null"`
}

// TableName pins the table name to the migration's.
func (SeriesValues) TableName() string { return "series_values" }

// SeriesLink says which profile one series of one building (or roof face,
// Part) uses in a draft or a model. Exactly one of ModelID and DraftID is set.
// Revision is the owner's config hash when the link was written.
type SeriesLink struct {
	ID          int64 `gorm:"primaryKey"`
	ModelID     *uint
	DraftID     *string `gorm:"size:255"`
	BuildingRef string  `gorm:"size:255;not null"`
	Part        string  `gorm:"size:255;not null;default:''"`
	Series      string  `gorm:"size:32;not null"`
	ProfileID   int64   `gorm:"not null"`
	Source      string  `gorm:"size:16;not null"`
	Revision    string  `gorm:"size:64;not null"`
	LinkedAt    time.Time
}

// TableName pins the table name to the migration's.
func (SeriesLink) TableName() string { return "series_links" }
