package technology

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gorm.io/gorm"
)

// Technology represents an energy technology
type Technology struct {
	ID          uint                   `gorm:"primaryKey" json:"id"`
	Key         string                 `gorm:"type:varchar(255);not null" json:"key"`
	Alias       string                 `gorm:"type:varchar(255);not null" json:"alias"`
	Icon        *string                `gorm:"type:varchar(100)" json:"icon"`
	Description *string                `gorm:"type:text" json:"description"`
	UserID      *string                `gorm:"type:varchar(255)" json:"user_id"`
	CreatedAt   time.Time              `gorm:"default:CURRENT_TIMESTAMP" json:"created_at"`
	UpdatedAt   time.Time              `gorm:"default:CURRENT_TIMESTAMP" json:"updated_at"`
	Constraints []TechnologyConstraint `gorm:"foreignKey:TechnologyID" json:"constraints"`
}

// TechnologyConstraint represents a configurable parameter for a technology
type TechnologyConstraint struct {
	ID           uint             `gorm:"primaryKey" json:"id"`
	Key          string           `gorm:"type:varchar(255);not null" json:"key"`
	Alias        string           `gorm:"type:varchar(255);not null" json:"alias"`
	Description  *string          `gorm:"type:text" json:"description,omitempty"`
	Unit         *string          `gorm:"type:varchar(100)" json:"unit"`
	DefaultValue *float64         `gorm:"type:double precision" json:"default_value"`
	Value        *float64         `gorm:"type:double precision" json:"value,omitempty"`
	MinValue     *float64         `gorm:"type:double precision;column:min_value" json:"min"`
	MaxValue     *float64         `gorm:"type:double precision;column:max_value" json:"max"`
	Required     bool             `gorm:"default:true" json:"required,omitempty"`
	RelationData *json.RawMessage `gorm:"type:jsonb;column:relation_data" json:"relationData,omitempty"`
	Options      *json.RawMessage `gorm:"type:jsonb;column:options" json:"options,omitempty"`
	TechnologyID uint             `gorm:"not null" json:"-"`
	CreatedAt    time.Time        `gorm:"default:CURRENT_TIMESTAMP" json:"-"`
	UpdatedAt    time.Time        `gorm:"default:CURRENT_TIMESTAMP" json:"-"`
}

// TableName specifies the table name for Technology
func (Technology) TableName() string {
	return "technologies"
}

// TableName specifies the table name for TechnologyConstraint
func (TechnologyConstraint) TableName() string {
	return "technology_constraints"
}

// parseFloatValue converts an interface{} to *float64
func parseFloatValue(v interface{}) *float64 {
	if v == nil {
		return nil
	}
	switch val := v.(type) {
	case float64:
		return &val
	case int:
		f := float64(val)
		return &f
	case string:
		var f float64
		if _, err := fmt.Sscanf(val, "%f", &f); err == nil {
			return &f
		}
	}
	return nil
}

// loadRelationData loads relation data from file or converts string reference
func loadRelationData(basePath, relationData string) *json.RawMessage {
	if relationData == "" {
		return nil
	}
	if strings.HasSuffix(relationData, ".json") {
		relDataPath := basePath + relationData
		relDataBytes, err := os.ReadFile(relDataPath)
		if err == nil {
			rawMsg := json.RawMessage(relDataBytes)
			return &rawMsg
		}
		fmt.Printf("Warning: Could not load relationData file %s: %v\n", relDataPath, err)
	}
	rawMsg := json.RawMessage(fmt.Sprintf("%q", relationData))
	return &rawMsg
}

// marshalOptions converts string slice to json.RawMessage
func marshalOptions(options []string) *json.RawMessage {
	if len(options) == 0 {
		return nil
	}
	optBytes, err := json.Marshal(options)
	if err != nil {
		return nil
	}
	rawMsg := json.RawMessage(optBytes)
	return &rawMsg
}

// Store handles database operations for technologies
type Store struct {
	db *gorm.DB
}

// NewStore creates a new technology store
func NewStore(db *gorm.DB) *Store {
	return &Store{db: db}
}

// GetAll returns all technologies for a user (including system defaults)
func (s *Store) GetAll(userID string) ([]Technology, error) {
	var technologies []Technology
	err := s.db.Preload("Constraints").
		Where("user_id IS NULL OR user_id = ?", userID).
		Order("alias ASC").
		Find(&technologies).Error
	return technologies, err
}

// GetAllIncludingUserDefined returns all technologies including all user-defined ones (for experts)
func (s *Store) GetAllIncludingUserDefined() ([]Technology, error) {
	var technologies []Technology
	err := s.db.Preload("Constraints").
		Order("alias ASC").
		Find(&technologies).Error
	return technologies, err
}

// GetByID returns a technology by ID
func (s *Store) GetByID(id uint, userID string) (*Technology, error) {
	var tech Technology
	err := s.db.Preload("Constraints").
		Where("id = ? AND (user_id IS NULL OR user_id = ?)", id, userID).
		First(&tech).Error
	if err != nil {
		return nil, err
	}
	return &tech, nil
}

// GetByIDUnfiltered returns a technology by ID without user filtering (for experts)
func (s *Store) GetByIDUnfiltered(id uint) (*Technology, error) {
	var tech Technology
	err := s.db.Preload("Constraints").
		Where("id = ?", id).
		First(&tech).Error
	if err != nil {
		return nil, err
	}
	return &tech, nil
}

// Create creates a new technology
func (s *Store) Create(tech *Technology) error {
	return s.db.Create(tech).Error
}

// Update updates a technology
func (s *Store) Update(tech *Technology) error {
	return s.db.Save(tech).Error
}

// Delete deletes a technology by ID
func (s *Store) Delete(id uint) error {
	result := s.db.Where("id = ?", id).Delete(&Technology{})
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return result.Error
}

// UpdateConstraints updates constraints for a technology
func (s *Store) UpdateConstraints(techID uint, constraints []TechnologyConstraint) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		// Delete existing constraints
		if err := tx.Where("technology_id = ?", techID).Delete(&TechnologyConstraint{}).Error; err != nil {
			return err
		}

		// Create new constraints
		for i := range constraints {
			constraints[i].TechnologyID = techID
			constraints[i].ID = 0 // Reset ID for new creation
		}

		if len(constraints) > 0 {
			if err := tx.Create(&constraints).Error; err != nil {
				return err
			}
		}

		return nil
	})
}

// KeyExistsAny checks if a technology key already exists (including system technologies)
func (s *Store) KeyExistsAny(key string, userID string) bool {
	var count int64
	// Check both user-owned and system technologies (user_id IS NULL)
	s.db.Model(&Technology{}).
		Where("key = ? AND (user_id = ? OR user_id IS NULL)", key, userID).
		Count(&count)
	return count > 0
}

// AddConstraint adds a new constraint to a technology
func (s *Store) AddConstraint(constraint *TechnologyConstraint) error {
	return s.db.Create(constraint).Error
}

// DeleteConstraint deletes a constraint by ID
func (s *Store) DeleteConstraint(constraintID uint, techID uint) error {
	result := s.db.Where("id = ? AND technology_id = ?", constraintID, techID).Delete(&TechnologyConstraint{})
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return result.Error
}

// ReseedFromDefaults reseeds system technologies from the default JSON file
func (s *Store) ReseedFromDefaults() (int, error) {
	// Try multiple paths for the default technologies JSON file
	// Start with paths relative to current working directory
	basePaths := []string{
		"initial-data/techs/",
		"../initial-data/techs/",
		"../../initial-data/techs/",
		"../../../initial-data/techs/",
	}

	// Also try paths relative to executable location
	if execPath, err := os.Executable(); err == nil {
		execDir := filepath.Dir(execPath)
		basePaths = append(basePaths,
			filepath.Join(execDir, "initial-data/techs")+"/",
			filepath.Join(execDir, "../initial-data/techs")+"/",
			filepath.Join(execDir, "../../initial-data/techs")+"/",
			filepath.Join(execDir, "../../../initial-data/techs")+"/",
		)
	}

	var data []byte
	var err error
	var basePath string
	for _, path := range basePaths {
		data, err = os.ReadFile(path + "default_technologies.json")
		if err == nil {
			basePath = path
			break
		}
	}
	if err != nil {
		return 0, fmt.Errorf("could not find default_technologies.json in any of the expected paths: %w", err)
	}

	// Delete existing system technologies (where user_id IS NULL) AFTER we confirmed the file exists
	if err := s.db.Where("user_id IS NULL").Delete(&Technology{}).Error; err != nil {
		return 0, err
	}

	var jsonData struct {
		Technologies []technologyJSON `json:"technologies"`
	}

	if err := json.Unmarshal(data, &jsonData); err != nil {
		return 0, err
	}

	count := 0
	for _, techJSON := range jsonData.Technologies {
		tech := s.createTechnologyFromJSON(techJSON)
		if err := s.db.Create(&tech).Error; err != nil {
			continue
		}
		s.createConstraintsFromJSON(tech.ID, techJSON.Constraints, basePath)
		count++
	}

	return count, nil
}

// technologyJSON represents the JSON structure for a technology
type technologyJSON struct {
	Key         string `json:"key"`
	Alias       string `json:"alias"`
	Icon        string `json:"icon"`
	Description string `json:"description"`
	Constraints []constraintJSON `json:"constraints"`
}

// constraintJSON represents the JSON structure for a constraint
type constraintJSON struct {
	Key          string      `json:"key"`
	Alias        string      `json:"alias"`
	Description  string      `json:"description"`
	DefaultValue interface{} `json:"default_value"`
	Unit         *string     `json:"unit"`
	Min          *float64    `json:"min"`
	Max          interface{} `json:"max"`
	RelationData string      `json:"relationData"`
	Options      []string    `json:"options"`
}

// createTechnologyFromJSON creates a Technology from JSON data
func (s *Store) createTechnologyFromJSON(techJSON technologyJSON) Technology {
	icon := techJSON.Icon
	desc := techJSON.Description
	return Technology{
		Key:         techJSON.Key,
		Alias:       techJSON.Alias,
		Icon:        &icon,
		Description: &desc,
		UserID:      nil, // System technology
	}
}

// createConstraintsFromJSON creates constraints for a technology from JSON data
func (s *Store) createConstraintsFromJSON(techID uint, constraints []constraintJSON, basePath string) {
	if len(constraints) == 0 {
		return
	}

	var dbConstraints []TechnologyConstraint
	for _, cJSON := range constraints {
		var desc *string
		if cJSON.Description != "" {
			desc = &cJSON.Description
		}

		dbConstraints = append(dbConstraints, TechnologyConstraint{
			TechnologyID: techID,
			Key:          cJSON.Key,
			Alias:        cJSON.Alias,
			Description:  desc,
			DefaultValue: parseFloatValue(cJSON.DefaultValue),
			Unit:         cJSON.Unit,
			MinValue:     cJSON.Min,
			MaxValue:     parseFloatValue(cJSON.Max),
			RelationData: loadRelationData(basePath, cJSON.RelationData),
			Options:      marshalOptions(cJSON.Options),
		})
	}

	if err := s.db.Create(&dbConstraints).Error; err != nil {
		return
	}
}
