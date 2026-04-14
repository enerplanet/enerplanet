package region

import (
	"encoding/json"
	"fmt"
	"strings"

	"spatialhub_backend/internal/models"

	"gorm.io/datatypes"
	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// Store handles database operations for cached regions
type Store struct {
	db *gorm.DB
}

// NewStore creates a new region Store instance
func NewStore(db *gorm.DB) *Store {
	return &Store{db: db}
}

// GetAllCachedRegions retrieves all cached regions that have grid data (for admin view)
func (rs *Store) GetAllCachedRegions() ([]models.CachedRegion, error) {
	var regions []models.CachedRegion
	if err := rs.db.Where("grid_count > 0").Order("country_code ASC, state_code ASC").Find(&regions).Error; err != nil {
		return nil, fmt.Errorf("get cached regions: %w", err)
	}
	return regions, nil
}

// GetEnabledCachedRegions retrieves only enabled cached regions (for public boundary display)
func (rs *Store) GetEnabledCachedRegions() ([]models.CachedRegion, error) {
	var regions []models.CachedRegion
	if err := rs.db.Where("grid_count > 0 AND enabled = true").Order("country_code ASC, state_code ASC").Find(&regions).Error; err != nil {
		return nil, fmt.Errorf("get enabled cached regions: %w", err)
	}
	return regions, nil
}

// DeleteCachedRegion removes a cached region by ID
func (rs *Store) DeleteCachedRegion(id uint) error {
	if err := rs.db.Delete(&models.CachedRegion{}, id).Error; err != nil {
		return fmt.Errorf("delete cached region %d: %w", id, err)
	}
	return nil
}

// ToggleCachedRegion sets the enabled state of a cached region
func (rs *Store) ToggleCachedRegion(id uint, enabled bool) error {
	if err := rs.db.Model(&models.CachedRegion{}).Where("id = ?", id).Update("enabled", enabled).Error; err != nil {
		return fmt.Errorf("toggle cached region %d: %w", id, err)
	}
	return nil
}

// PylovoRegionResponse represents the response from the PyLovo API
type PylovoRegionResponse struct {
	Status  string         `json:"status"`
	Regions []PylovoRegion `json:"regions"`
}

// PylovoRegion represents a single region from the PyLovo API
type PylovoRegion struct {
	CountryCode string `json:"country_code"`
	StateCode   string `json:"state_code"`
	GridCount   int    `json:"grid_count"`
	Has3D       bool   `json:"has_3d"`
	Centroid    struct {
		Lat float64 `json:"lat"`
		Lon float64 `json:"lon"`
	} `json:"centroid"`
	Bbox struct {
		West  float64 `json:"west"`
		South float64 `json:"south"`
		East  float64 `json:"east"`
		North float64 `json:"north"`
	} `json:"bbox"`
	Region *struct {
		Name        string `json:"name"`
		AdminLevel  int    `json:"admin_level"`
		Country     string `json:"country"`
		CountryCode string `json:"country_code"`
		StateCode   string `json:"state_code"`
		OsmID       int64  `json:"osm_id"`
		OsmType     string `json:"osm_type"`
	} `json:"region,omitempty"`
	Boundary json.RawMessage `json:"boundary,omitempty"`
}

func normalizeStateCode(value string) string {
	return strings.ToLower(strings.TrimSpace(value))
}

func normalizeCountryCode(value string) string {
	return strings.ToUpper(strings.TrimSpace(value))
}

// UpsertRegionsFromAPI parses the PyLovo API response, upserts current regions,
// and prunes stale cached rows for the countries included in the payload.
func (rs *Store) UpsertRegionsFromAPI(responseBody []byte) error {
	var parsed PylovoRegionResponse
	if err := json.Unmarshal(responseBody, &parsed); err != nil {
		return fmt.Errorf("unmarshal regions response: %w", err)
	}

	if len(parsed.Regions) == 0 {
		var wrapper struct {
			Data PylovoRegionResponse `json:"data"`
		}
		if err := json.Unmarshal(responseBody, &wrapper); err == nil {
			parsed = wrapper.Data
		}
	}

	if parsed.Status != "success" {
		return nil
	}

	currentByCountry := make(map[string]map[string]struct{})
	currentRegions := make([]models.CachedRegion, 0, len(parsed.Regions))

	for _, r := range parsed.Regions {
		if r.Region == nil || strings.TrimSpace(r.Region.Name) == "" {
			continue
		}

		countryCode := normalizeCountryCode(r.CountryCode)
		if countryCode == "" {
			countryCode = normalizeCountryCode(r.Region.CountryCode)
		}
		if countryCode == "" {
			continue
		}

		stateCode := normalizeStateCode(r.StateCode)
		if stateCode == "" {
			stateCode = normalizeStateCode(r.Region.StateCode)
		}
		if stateCode == "" {
			continue
		}

		if _, ok := currentByCountry[countryCode]; !ok {
			currentByCountry[countryCode] = make(map[string]struct{})
		}
		currentByCountry[countryCode][stateCode] = struct{}{}

		var boundaryJSON datatypes.JSON
		if r.Boundary != nil {
			boundaryJSON = datatypes.JSON(r.Boundary)
		}

		currentRegions = append(currentRegions, models.CachedRegion{
			RegionName:  strings.TrimSpace(r.Region.Name),
			Country:     strings.TrimSpace(r.Region.Country),
			CountryCode: countryCode,
			StateCode:   stateCode,
			AdminLevel:  r.Region.AdminLevel,
			OsmID:       r.Region.OsmID,
			OsmType:     r.Region.OsmType,
			GridCount:   r.GridCount,
			Has3D:       r.Has3D,
			CentroidLat: r.Centroid.Lat,
			CentroidLon: r.Centroid.Lon,
			BboxWest:    r.Bbox.West,
			BboxSouth:   r.Bbox.South,
			BboxEast:    r.Bbox.East,
			BboxNorth:   r.Bbox.North,
			Boundary:    boundaryJSON,
		})
	}

	return rs.db.Transaction(func(tx *gorm.DB) error {
		for countryCode, stateCodes := range currentByCountry {
			codes := make([]string, 0, len(stateCodes))
			for stateCode := range stateCodes {
				codes = append(codes, stateCode)
			}
			if len(codes) == 0 {
				continue
			}

			if err := tx.Model(&models.CachedRegion{}).
				Where("country_code = ? AND state_code NOT IN ?", countryCode, codes).
				Update("grid_count", 0).Error; err != nil {
				return fmt.Errorf("zero stale cached regions for %s: %w", countryCode, err)
			}
		}

		if err := tx.Clauses(clause.OnConflict{
			Columns: []clause.Column{{Name: "country_code"}, {Name: "state_code"}},
			DoUpdates: clause.AssignmentColumns([]string{
				"region_name", "grid_count", "has3_d", "centroid_lat", "centroid_lon",
				"bbox_west", "bbox_south", "bbox_east", "bbox_north", "boundary",
				"admin_level", "osm_id", "osm_type", "country", "updated_at",
			}),
		}).CreateInBatches(currentRegions, 100).Error; err != nil {
			return fmt.Errorf("batch upsert regions: %w", err)
		}
		return nil
	})
}

// BuildAvailableRegionsResponse builds the API response from cached regions
func BuildAvailableRegionsResponse(regions []models.CachedRegion) ([]byte, error) {
	type regionInfo struct {
		Name        string `json:"name"`
		AdminLevel  int    `json:"admin_level"`
		Country     string `json:"country"`
		CountryCode string `json:"country_code"`
		StateCode   string `json:"state_code"`
		OsmID       int64  `json:"osm_id"`
		OsmType     string `json:"osm_type"`
	}

	type centroid struct {
		Lat float64 `json:"lat"`
		Lon float64 `json:"lon"`
	}

	type bbox struct {
		West  float64 `json:"west"`
		South float64 `json:"south"`
		East  float64 `json:"east"`
		North float64 `json:"north"`
	}

	type regionEntry struct {
		CountryCode string          `json:"country_code"`
		StateCode   string          `json:"state_code"`
		GridCount   int             `json:"grid_count"`
		Has3D       bool            `json:"has_3d"`
		Centroid    centroid        `json:"centroid"`
		Bbox        bbox            `json:"bbox"`
		Region      *regionInfo     `json:"region,omitempty"`
		Boundary    json.RawMessage `json:"boundary,omitempty"`
	}

	entries := make([]regionEntry, 0, len(regions))
	for _, r := range regions {
		entry := regionEntry{
			CountryCode: r.CountryCode,
			StateCode:   r.StateCode,
			GridCount:   r.GridCount,
			Has3D:       r.Has3D,
			Centroid:    centroid{Lat: r.CentroidLat, Lon: r.CentroidLon},
			Bbox:        bbox{West: r.BboxWest, South: r.BboxSouth, East: r.BboxEast, North: r.BboxNorth},
			Region: &regionInfo{
				Name:        r.RegionName,
				AdminLevel:  r.AdminLevel,
				Country:     r.Country,
				CountryCode: r.CountryCode,
				StateCode:   r.StateCode,
				OsmID:       r.OsmID,
				OsmType:     r.OsmType,
			},
		}
		if r.Boundary != nil {
			entry.Boundary = json.RawMessage(r.Boundary)
		}
		entries = append(entries, entry)
	}

	response := map[string]interface{}{
		"data": map[string]interface{}{
			"status":  "success",
			"regions": entries,
		},
	}

	return json.Marshal(response)
}
