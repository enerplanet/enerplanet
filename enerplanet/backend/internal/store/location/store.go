package location

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"

	"spatialhub_backend/internal/models"

	"github.com/google/uuid"
	"github.com/lib/pq"
	"gorm.io/datatypes"
	"gorm.io/gorm"
)

var errLocationNotFound = errors.New("location not found")

const (
	statusActive       = "active"
	queryStatusActive  = "status = ?"
	orderCreatedAtDesc = "created_at DESC"
)

// setIfNotNil adds a value to the updates map if the pointer is not nil
func setIfNotNil[T any](updates map[string]interface{}, key string, val *T) {
	if val != nil {
		updates[key] = *val
	}
}

// PaginationParams holds pagination parameters
type PaginationParams struct {
	Page    int
	PerPage int
}

func paginate(query *gorm.DB, pagination PaginationParams) *gorm.DB {
	if pagination.Page < 1 {
		pagination.Page = 1
	}
	if pagination.PerPage <= 0 {
		pagination.PerPage = 10
	}
	offset := (pagination.Page - 1) * pagination.PerPage
	return query.Offset(offset).Limit(pagination.PerPage)
}

// Store handles database operations for custom locations
type Store struct {
	db *gorm.DB
}

// NewStore creates a new location Store instance
func NewStore(db *gorm.DB) *Store {
	return &Store{db: db}
}

// Filters represents filters for querying locations
type Filters struct {
	FClass   string
	IsPublic *bool
	Status   string
}

// CreateLocation creates a new custom location
func (ls *Store) CreateLocation(userID string, req *models.CustomLocationCreateRequest) (*models.CustomLocation, error) {
	geometryJSON, err := json.Marshal(req.Geometry)
	if err != nil {
		return nil, fmt.Errorf("marshal geometry: %w", err)
	}

	geometryAreaJSON, err := json.Marshal(req.GeometryArea)
	if err != nil {
		return nil, fmt.Errorf("marshal geometry_area: %w", err)
	}

	loc := &models.CustomLocation{
		UserID:       userID,
		OsmID:        "custom_" + uuid.New().String()[:8],
		Title:        req.Title,
		FClass:       req.FClass,
		Area:         req.Area,
		DemandEnergy: req.DemandEnergy,
		Geometry:     datatypes.JSON(geometryJSON),
		GeometryArea: datatypes.JSON(geometryAreaJSON),
		Tags:         pq.StringArray(req.Tags),
		IsPublic:     req.IsPublic,
		Status:       statusActive,
	}

	if err := ls.db.Create(loc).Error; err != nil {
		return nil, fmt.Errorf("create location: %w", err)
	}

	return loc, nil
}

// GetLocationByID retrieves a single location by ID
func (ls *Store) GetLocationByID(id uint) (*models.CustomLocation, error) {
	var loc models.CustomLocation
	if err := ls.db.First(&loc, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, errLocationNotFound
		}
		return nil, fmt.Errorf("get location: %w", err)
	}
	return &loc, nil
}

// GetUserLocations retrieves all locations for a specific user
func (ls *Store) GetUserLocations(userID string, filters Filters, pagination PaginationParams) (*models.CustomLocationListResponse, error) {
	query := ls.db.Model(&models.CustomLocation{}).Where("user_id = ?", userID).Where(queryStatusActive, statusActive)
	return ls.paginatedLocationQuery(query, filters, pagination, "user locations")
}

// GetPublicLocations retrieves all public locations
func (ls *Store) GetPublicLocations(filters Filters, pagination PaginationParams) (*models.CustomLocationListResponse, error) {
	query := ls.db.Model(&models.CustomLocation{}).Where("is_public = ?", true).Where(queryStatusActive, statusActive)
	return ls.paginatedLocationQuery(query, filters, pagination, "public locations")
}

// GetAllAccessibleLocations retrieves all locations accessible to a user (own + public)
func (ls *Store) GetAllAccessibleLocations(userID string, filters Filters, pagination PaginationParams) (*models.CustomLocationListResponse, error) {
	query := ls.db.Model(&models.CustomLocation{}).
		Where(queryStatusActive, statusActive).
		Where("user_id = ? OR is_public = ?", userID, true)
	return ls.paginatedLocationQuery(query, filters, pagination, "accessible locations")
}

// paginatedLocationQuery executes a filtered, paginated location query and returns the response
func (ls *Store) paginatedLocationQuery(query *gorm.DB, filters Filters, pagination PaginationParams, label string) (*models.CustomLocationListResponse, error) {
	query = applyLocationFilters(query, filters)

	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, fmt.Errorf("count %s: %w", label, err)
	}

	var locations []models.CustomLocation
	if err := paginate(query, pagination).Order(orderCreatedAtDesc).Find(&locations).Error; err != nil {
		return nil, fmt.Errorf("find %s: %w", label, err)
	}

	totalPages := int(math.Ceil(float64(total) / float64(pagination.PerPage)))

	return &models.CustomLocationListResponse{
		Data:       locations,
		Total:      total,
		Page:       pagination.Page,
		PerPage:    pagination.PerPage,
		TotalPages: totalPages,
	}, nil
}

// UpdateLocation updates an existing custom location
func (ls *Store) UpdateLocation(id uint, userID string, req *models.CustomLocationUpdateRequest) (*models.CustomLocation, error) {
	loc, err := ls.GetLocationByID(id)
	if err != nil {
		return nil, err
	}

	if loc.UserID != userID {
		return nil, fmt.Errorf("not authorized to update this location")
	}

	updates := make(map[string]interface{})

	setIfNotNil(updates, "title", req.Title)
	setIfNotNil(updates, "f_class", req.FClass)
	setIfNotNil(updates, "area", req.Area)
	setIfNotNil(updates, "demand_energy", req.DemandEnergy)
	setIfNotNil(updates, "is_public", req.IsPublic)

	if req.Geometry != nil {
		geometryJSON, err := json.Marshal(*req.Geometry)
		if err != nil {
			return nil, fmt.Errorf("marshal geometry: %w", err)
		}
		updates["geometry"] = datatypes.JSON(geometryJSON)
	}
	if req.GeometryArea != nil {
		geometryAreaJSON, err := json.Marshal(*req.GeometryArea)
		if err != nil {
			return nil, fmt.Errorf("marshal geometry_area: %w", err)
		}
		updates["geometry_area"] = datatypes.JSON(geometryAreaJSON)
	}
	if req.Tags != nil {
		updates["tags"] = pq.StringArray(*req.Tags)
	}

	if len(updates) == 0 {
		return loc, nil
	}

	if err := ls.db.Model(loc).Updates(updates).Error; err != nil {
		return nil, fmt.Errorf("update location: %w", err)
	}

	return ls.GetLocationByID(id)
}

// DeleteLocation soft-deletes a custom location
func (ls *Store) DeleteLocation(id uint, userID string) error {
	loc, err := ls.GetLocationByID(id)
	if err != nil {
		return err
	}

	if loc.UserID != userID {
		return fmt.Errorf("not authorized to delete this location")
	}

	if err := ls.db.Model(loc).Update("status", "deleted").Error; err != nil {
		return fmt.Errorf("delete location: %w", err)
	}

	return nil
}

// CopyLocation creates a copy of an existing location for the user
func (ls *Store) CopyLocation(id uint, userID string) (*models.CustomLocation, error) {
	loc, err := ls.GetLocationByID(id)
	if err != nil {
		return nil, err
	}

	if loc.UserID != userID && !loc.IsPublic {
		return nil, fmt.Errorf("not authorized to copy this location")
	}

	newLocation := &models.CustomLocation{
		UserID:       userID,
		OsmID:        "custom_" + uuid.New().String()[:8],
		Title:        loc.Title + " (Copy)",
		FClass:       loc.FClass,
		Area:         loc.Area,
		DemandEnergy: loc.DemandEnergy,
		Geometry:     loc.Geometry,
		GeometryArea: loc.GeometryArea,
		Tags:         loc.Tags,
		IsPublic:     false,
		Status:       statusActive,
	}

	if err := ls.db.Create(newLocation).Error; err != nil {
		return nil, fmt.Errorf("copy location: %w", err)
	}

	return newLocation, nil
}

// GetLocationsAsGeoJSON returns all user locations as GeoJSON FeatureCollection
func (ls *Store) GetLocationsAsGeoJSON(userID string) (map[string]interface{}, error) {
	var locations []models.CustomLocation
	if err := ls.db.Where("user_id = ?", userID).Where(queryStatusActive, statusActive).Find(&locations).Error; err != nil {
		return nil, fmt.Errorf("get locations: %w", err)
	}

	features := make([]map[string]interface{}, 0, len(locations))
	for _, loc := range locations {
		var geometryArea map[string]interface{}
		if err := json.Unmarshal(loc.GeometryArea, &geometryArea); err != nil {
			continue
		}

		tags := []string(loc.Tags)

		feature := map[string]interface{}{
			"type":     "Feature",
			"geometry": geometryArea,
			"properties": map[string]interface{}{
				"id":            loc.ID,
				"osm_id":        loc.OsmID,
				"title":         loc.Title,
				"feature_type":  "CustomLocation",
				"f_class":       loc.FClass,
				"area":          loc.Area,
				"demand_energy": loc.DemandEnergy,
				"tags":          tags,
				"is_public":     loc.IsPublic,
				"created_at":    loc.CreatedAt,
				"updated_at":    loc.UpdatedAt,
			},
		}
		features = append(features, feature)
	}

	return map[string]interface{}{
		"type":     "FeatureCollection",
		"features": features,
	}, nil
}

func applyLocationFilters(query *gorm.DB, filters Filters) *gorm.DB {
	if filters.FClass != "" {
		query = query.Where("f_class = ?", filters.FClass)
	}
	if filters.IsPublic != nil {
		query = query.Where("is_public = ?", *filters.IsPublic)
	}
	if filters.Status != "" {
		query = query.Where(queryStatusActive, filters.Status)
	}
	return query
}
