package main

import (
	"encoding/json"
	"log"
	"os"
	"strings"
	"time"

	"gorm.io/gorm"
)

// Technology represents an energy technology
type Technology struct {
	ID          uint       `gorm:"primaryKey"`
	Key         string     `gorm:"type:varchar(255);not null"`
	Alias       string     `gorm:"type:varchar(255);not null"`
	Icon        *string    `gorm:"type:varchar(100)"`
	Description *string    `gorm:"type:text"`
	UserID      *string    `gorm:"type:varchar(255)"`
	CreatedAt   time.Time  `gorm:"default:CURRENT_TIMESTAMP"`
	UpdatedAt   time.Time  `gorm:"default:CURRENT_TIMESTAMP"`
	Constraints []TechnologyConstraint `gorm:"foreignKey:TechnologyID"`
}

// TechnologyConstraint represents a configurable parameter for a technology
type TechnologyConstraint struct {
	ID            uint      `gorm:"primaryKey"`
	Key           string    `gorm:"type:varchar(255);not null"`
	Alias         string    `gorm:"type:varchar(255);not null"`
	Description   *string   `gorm:"type:text"`
	Unit          *string   `gorm:"type:varchar(100)"`
	DefaultValue  *float64  `gorm:"type:double precision"`
	Value         *float64  `gorm:"type:double precision"`
	MinValue      *float64  `gorm:"type:double precision;column:min_value"`
	MaxValue      *float64  `gorm:"type:double precision;column:max_value"`
	Required      bool      `gorm:"default:true"`
	OsmBasedValue *string   `gorm:"type:varchar(255);column:osm_based_value"`
	RelationData  *string   `gorm:"type:jsonb;column:relation_data"`
	Options       *string   `gorm:"type:jsonb"`
	TechnologyID  uint      `gorm:"not null"`
	CreatedAt     time.Time `gorm:"default:CURRENT_TIMESTAMP"`
	UpdatedAt     time.Time `gorm:"default:CURRENT_TIMESTAMP"`
}

// TableName specifies the table name for Technology
func (Technology) TableName() string {
	return "technologies"
}

// TableName specifies the table name for TechnologyConstraint
func (TechnologyConstraint) TableName() string {
	return "technology_constraints"
}

// JSON structures for parsing the technologies file
type TechnologiesJSON struct {
	Technologies []TechnologyJSON `json:"technologies"`
}

type TechnologyJSON struct {
	Key         string           `json:"key"`
	Alias       string           `json:"alias"`
	Icon        string           `json:"icon"`
	Description string           `json:"description"`
	Constraints []ConstraintJSON `json:"constraints"`
}

type ConstraintJSON struct {
	Key          string      `json:"key"`
	Alias        string      `json:"alias"`
	DefaultValue interface{} `json:"default_value"`
	Unit         *string     `json:"unit"`
	Min          interface{} `json:"min"`
	Max          interface{} `json:"max"`
	Required     *bool       `json:"required"`
	OsmBasedValue *string    `json:"osm_based_value"`
	RelationData interface{} `json:"relationData"` // Changed from *string to interface{}
	Options      []string    `json:"options"`
}

// TechDescriptionJSON represents the tech_description_data.json structure
type TechDescriptionJSON struct {
	Techs []TechDescItem `json:"techs"`
}

type TechDescItem struct {
	Name        string `json:"Name"`
	Unit        string `json:"Unit"`
	Description string `json:"Description"`
}

// loadTechDescriptions loads descriptions from tech_description_data.json
func loadTechDescriptions() map[string]string {
	descMap := make(map[string]string)
	
	// Try different paths
	paths := []string{
		"../../initial-data/techs/tech_description_data.json",
		"../initial-data/techs/tech_description_data.json",
		"initial-data/techs/tech_description_data.json",
	}
	
	var data []byte
	var err error
	for _, path := range paths {
		data, err = os.ReadFile(path)
		if err == nil {
			break
		}
	}
	
	if err != nil {
		log.Printf("Warning: Could not load tech_description_data.json: %v", err)
		return descMap
	}
	
	var descData TechDescriptionJSON
	if err := json.Unmarshal(data, &descData); err != nil {
		log.Printf("Warning: Failed to parse tech_description_data.json: %v", err)
		return descMap
	}
	
	// Build map with lowercase keys for case-insensitive matching
	for _, item := range descData.Techs {
		descMap[strings.ToLower(item.Name)] = item.Description
	}
	
	log.Printf("Loaded %d tech descriptions", len(descMap))
	return descMap
}

// getDescription finds description by alias (case-insensitive)
func getDescription(alias string, descMap map[string]string) *string {
	if desc, ok := descMap[strings.ToLower(alias)]; ok {
		return &desc
	}
	return nil
}

func seedTechnologies(db *gorm.DB) {
	// Load tech descriptions first
	techDescriptions := loadTechDescriptions()
	
	// Read the JSON file
	jsonFile := "../../initial-data/techs/default_technologies.json"
	data, err := os.ReadFile(jsonFile)
	if err != nil {
		// Try alternative path (from project root)
		jsonFile = "../initial-data/techs/default_technologies.json"
		data, err = os.ReadFile(jsonFile)
		if err != nil {
			// Try local path
			jsonFile = "initial-data/techs/default_technologies.json"
			data, err = os.ReadFile(jsonFile)
			if err != nil {
				log.Printf("Failed to read technologies JSON file: %v", err)
				return
			}
		}
	}

	var techData TechnologiesJSON
	if err := json.Unmarshal(data, &techData); err != nil {
		log.Printf("Failed to parse technologies JSON: %v", err)
		return
	}

	// Delete existing default technologies (where user_id is NULL)
	if err := db.Where("user_id IS NULL").Delete(&Technology{}).Error; err != nil {
		log.Printf("Warning: Failed to delete existing default technologies: %v", err)
	}

	// Seed each technology
	for _, techJSON := range techData.Technologies {
		icon := techJSON.Icon
		description := techJSON.Description

		tech := Technology{
			Key:         techJSON.Key,
			Alias:       techJSON.Alias,
			Icon:        &icon,
			Description: &description,
			UserID:      nil, // Default technologies have no user_id
		}

		if err := db.Create(&tech).Error; err != nil {
			log.Printf("Failed to create technology %s: %v", techJSON.Key, err)
			continue
		}

		log.Printf("Created technology: %s (%s)", tech.Alias, tech.Key)

		// Seed constraints for this technology
		for _, constraintJSON := range techJSON.Constraints {
			constraint := TechnologyConstraint{
				Key:          constraintJSON.Key,
				Alias:        constraintJSON.Alias,
				TechnologyID: tech.ID,
				Required:     true,
			}

			// Get description from tech_description_data.json by matching alias
			constraint.Description = getDescription(constraintJSON.Alias, techDescriptions)

			// Handle unit
			if constraintJSON.Unit != nil {
				constraint.Unit = constraintJSON.Unit
			}

			// Handle default value (can be number or "INF")
			if constraintJSON.DefaultValue != nil {
				switch v := constraintJSON.DefaultValue.(type) {
				case float64:
					constraint.DefaultValue = &v
				case string:
					// INF is stored as NULL (no value), otherwise ignore strings
					// as they are typically special values like "INF"
				}
			}

			// Handle min value
			if constraintJSON.Min != nil {
				switch v := constraintJSON.Min.(type) {
				case float64:
					constraint.MinValue = &v
				}
			}

			// Handle max value
			if constraintJSON.Max != nil {
				switch v := constraintJSON.Max.(type) {
				case float64:
					constraint.MaxValue = &v
				}
				// INF is stored as NULL
			}

			// Handle required
			if constraintJSON.Required != nil {
				constraint.Required = *constraintJSON.Required
			}

			// Handle osm_based_value
			if constraintJSON.OsmBasedValue != nil {
				constraint.OsmBasedValue = constraintJSON.OsmBasedValue
			}

			// Handle relationData - if it's a filename ending in .json, load the file content
			if constraintJSON.RelationData != nil {
				switch v := constraintJSON.RelationData.(type) {
				case string:
					if strings.HasSuffix(v, ".json") {
						// Try to load the JSON file and embed its content
						relPaths := []string{
							"../../initial-data/techs/" + v,
							"../initial-data/techs/" + v,
							"initial-data/techs/" + v,
						}
						var relData []byte
						var relErr error
						for _, relPath := range relPaths {
							relData, relErr = os.ReadFile(relPath)
							if relErr == nil {
								break
							}
						}
						if relErr == nil {
							relStr := string(relData)
							constraint.RelationData = &relStr
						} else {
							log.Printf("Warning: Could not load relationData file %s: %v", v, relErr)
							// Store filename as fallback
							relationJSON, _ := json.Marshal(v)
							relationStr := string(relationJSON)
							constraint.RelationData = &relationStr
						}
					} else {
						// Store string value as-is
						relationJSON, _ := json.Marshal(v)
						relationStr := string(relationJSON)
						constraint.RelationData = &relationStr
					}
				default:
					// For other types (objects), marshal as JSON
					relationJSON, err := json.Marshal(constraintJSON.RelationData)
					if err == nil {
						relationStr := string(relationJSON)
						constraint.RelationData = &relationStr
					} else {
						log.Printf("Warning: Failed to marshal relationData for %s: %v", constraintJSON.Key, err)
					}
				}
			}

			// Handle options (store as JSON array)
			if len(constraintJSON.Options) > 0 {
				optionsJSON, _ := json.Marshal(constraintJSON.Options)
				optionsStr := string(optionsJSON)
				// Ensure it's a valid JSON string literal for the DB if needed, 
				// but GORM should handle string -> jsonb conversion if the driver supports it.
				// However, the error 22P02 often means the string format is wrong for the column type.
				// Let's try passing the raw bytes or ensuring it's treated as a string literal.
				constraint.Options = &optionsStr
			}

			if err := db.Create(&constraint).Error; err != nil {
				log.Printf("  Failed to create constraint %s: %v", constraintJSON.Key, err)
			}
		}

		log.Printf("  Added %d constraints", len(techJSON.Constraints))
	}

	log.Printf("Successfully seeded %d technologies", len(techData.Technologies))
}
