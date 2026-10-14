// Package series persists hourly series once per distinct result
// (models.SeriesProfile, models.SeriesValues) and the links that say which
// result each building of a draft or model uses (models.SeriesLink).
package series

import (
	"errors"
	"fmt"
	"time"

	"github.com/lib/pq"
	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"

	"spatialhub_backend/internal/models"
)

// Store handles database operations for stored series and their links.
type Store struct {
	db *gorm.DB
}

// NewStore creates a series Store.
func NewStore(db *gorm.DB) *Store {
	return &Store{db: db}
}

// Owner is the draft or the model a link belongs to. Exactly one of ModelID
// and DraftID is set.
type Owner struct {
	ModelID uint
	DraftID string
}

func (o Owner) validate() error {
	if (o.ModelID == 0) == (o.DraftID == "") {
		return fmt.Errorf("owner must be exactly one of a model or a draft, got model %d draft %q", o.ModelID, o.DraftID)
	}
	return nil
}

// NewProfile is a result to store: its key, who produced it and its series.
type NewProfile struct {
	Key               string
	Origin            string
	OwnerUserID       string // uploads only
	ProducerVersion   string
	StartTime         time.Time
	ResolutionMinutes int
	Summary           datatypes.JSON
	// Series maps a series name (heating, electricity, pv, ...) to its values.
	Series map[string]SeriesData
}

// SeriesData is one series' values, as energy per step in Unit.
type SeriesData struct {
	Unit   string
	Values []float32
}

// Link ties one series of one building, or of one roof face (Part), to a
// stored profile.
type Link struct {
	BuildingRef string
	Part        string
	Series      string
	ProfileID   int64
	Source      string
}

// StoredKeys returns, for each of keys already stored, its profile id.
func (s *Store) StoredKeys(keys []string) (map[string]int64, error) {
	found := make(map[string]int64, len(keys))
	if len(keys) == 0 {
		return found, nil
	}
	var rows []models.SeriesProfile
	if err := s.db.Select("id", "key").Where("key IN ?", keys).Find(&rows).Error; err != nil {
		return nil, fmt.Errorf("look up %d series keys: %w", len(keys), err)
	}
	for _, r := range rows {
		found[r.Key] = r.ID
	}
	return found, nil
}

// Save stores p unless its key is already stored, and returns the profile id
// either way. A stored profile is never changed: two callers saving the same
// key concurrently both get the one row the first of them wrote.
func (s *Store) Save(p NewProfile) (int64, error) {
	if err := p.validate(); err != nil {
		return 0, err
	}
	var id int64
	err := s.db.Transaction(func(tx *gorm.DB) error {
		row := models.SeriesProfile{
			Key:               p.Key,
			Origin:            p.Origin,
			OwnerUserID:       optional(p.OwnerUserID),
			ProducerVersion:   optional(p.ProducerVersion),
			StartTime:         p.StartTime,
			ResolutionMinutes: p.ResolutionMinutes,
			Summary:           p.Summary,
		}
		res := tx.Clauses(clause.OnConflict{Columns: []clause.Column{{Name: "key"}}, DoNothing: true}).Create(&row)
		if res.Error != nil {
			return fmt.Errorf("insert series profile %s: %w", p.Key, res.Error)
		}
		if res.RowsAffected == 0 {
			var existing models.SeriesProfile
			if err := tx.Select("id").Where("key = ?", p.Key).Take(&existing).Error; err != nil {
				return fmt.Errorf("read stored series profile %s: %w", p.Key, err)
			}
			id = existing.ID
			return nil
		}
		id = row.ID
		values := make([]models.SeriesValues, 0, len(p.Series))
		for name, data := range p.Series {
			values = append(values, models.SeriesValues{
				ProfileID: row.ID, Series: name, Unit: data.Unit, Vals: pq.Float32Array(data.Values),
			})
		}
		if err := tx.Create(&values).Error; err != nil {
			return fmt.Errorf("insert series of profile %s: %w", p.Key, err)
		}
		return nil
	})
	return id, err
}

func (p NewProfile) validate() error {
	if p.Key == "" {
		return errors.New("series profile key is empty")
	}
	if len(p.Series) == 0 {
		return fmt.Errorf("series profile %s has no series", p.Key)
	}
	if p.ResolutionMinutes <= 0 {
		return fmt.Errorf("series profile %s has resolution %d minutes", p.Key, p.ResolutionMinutes)
	}
	for name, data := range p.Series {
		if len(data.Values) == 0 || data.Unit == "" {
			return fmt.Errorf("series %s of profile %s needs values and a unit", name, p.Key)
		}
	}
	return nil
}

// Link writes links for owner at revision, replacing any existing link for
// the same building, part and series.
func (s *Store) Link(owner Owner, revision string, links []Link) error {
	if err := owner.validate(); err != nil {
		return err
	}
	if len(links) == 0 {
		return nil
	}
	now := time.Now().UTC()
	rows := make([]models.SeriesLink, len(links))
	for i, l := range links {
		rows[i] = models.SeriesLink{
			BuildingRef: l.BuildingRef, Part: l.Part, Series: l.Series,
			ProfileID: l.ProfileID, Source: l.Source, Revision: revision, LinkedAt: now,
		}
		if owner.ModelID != 0 {
			rows[i].ModelID = &owner.ModelID
		} else {
			rows[i].DraftID = &owner.DraftID
		}
	}
	ownerColumn := "draft_id"
	if owner.ModelID != 0 {
		ownerColumn = "model_id"
	}
	// The conflict target names the partial unique index for this owner kind.
	upsert := clause.OnConflict{
		Columns: []clause.Column{
			{Name: ownerColumn}, {Name: "building_ref"}, {Name: "part"}, {Name: "series"},
		},
		TargetWhere: clause.Where{Exprs: []clause.Expression{clause.Expr{SQL: ownerColumn + " IS NOT NULL"}}},
		DoUpdates:   clause.AssignmentColumns([]string{"profile_id", "source", "revision", "linked_at"}),
	}
	if err := s.db.Clauses(upsert).Create(&rows).Error; err != nil {
		return fmt.Errorf("write %d series links for %+v: %w", len(rows), owner, err)
	}
	return nil
}

// Links returns every link of owner.
func (s *Store) Links(owner Owner) ([]models.SeriesLink, error) {
	if err := owner.validate(); err != nil {
		return nil, err
	}
	q := s.db.Where("draft_id = ?", owner.DraftID)
	if owner.ModelID != 0 {
		q = s.db.Where("model_id = ?", owner.ModelID)
	}
	var links []models.SeriesLink
	if err := q.Order("building_ref, part, series").Find(&links).Error; err != nil {
		return nil, fmt.Errorf("read series links for %+v: %w", owner, err)
	}
	return links, nil
}

// Values returns one series of a stored profile.
func (s *Store) Values(profileID int64, series string) (models.SeriesValues, error) {
	var v models.SeriesValues
	if err := s.db.Where("profile_id = ? AND series = ?", profileID, series).Take(&v).Error; err != nil {
		return models.SeriesValues{}, fmt.Errorf("read series %s of profile %d: %w", series, profileID, err)
	}
	return v, nil
}

func optional(s string) *string {
	if s == "" {
		return nil
	}
	return &s
}
