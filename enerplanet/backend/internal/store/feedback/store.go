package feedback

import (
	"errors"
	"fmt"
	"math"
	"strings"

	"platform.local/common/pkg/constants"
	"platform.local/common/pkg/models"

	"gorm.io/gorm"
)

var errFeedbackNotFound = errors.New("feedback not found")

type Store struct {
	db *gorm.DB
}

func NewStore(db *gorm.DB) *Store {
	return &Store{db: db}
}

type Filters struct {
	Status   string
	Category string
	Priority string
	UserID   *string
}

type PaginationParams struct {
	Page    int
	PerPage int
}

type ListResponse struct {
	Data       []models.Feedback `json:"data"`
	Total      int64             `json:"total"`
	Page       int               `json:"page"`
	PerPage    int               `json:"per_page"`
	TotalPages int               `json:"total_pages"`
}

func applyFilters(query *gorm.DB, filters Filters) *gorm.DB {
	if filters.Status != "" && filters.Status != constants.AccessLevelAll {
		query = query.Where("status = ?", filters.Status)
	}
	if filters.Category != "" && filters.Category != constants.AccessLevelAll {
		query = query.Where("category = ?", filters.Category)
	}
	if filters.Priority != "" && filters.Priority != constants.AccessLevelAll {
		query = query.Where("priority = ?", filters.Priority)
	}
	if filters.UserID != nil {
		query = query.Where("user_id = ?", *filters.UserID)
	}
	return query
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

func (fs *Store) CreateFeedback(feedback *models.Feedback) error {
	if err := fs.db.Create(feedback).Error; err != nil {
		return fmt.Errorf("create feedback: %w", err)
	}
	return nil
}

func (fs *Store) GetFeedbackByID(id uint) (*models.Feedback, error) {
	var feedback models.Feedback
	if err := fs.db.First(&feedback, id).Error; err != nil {
		if err == gorm.ErrRecordNotFound {
			return nil, errFeedbackNotFound
		}
		return nil, fmt.Errorf("get feedback: %w", err)
	}
	return &feedback, nil
}

func buildListResponse(feedbacks []models.Feedback, total int64, pagination PaginationParams) *ListResponse {
	totalPages := int(math.Ceil(float64(total) / float64(pagination.PerPage)))
	return &ListResponse{
		Data:       feedbacks,
		Total:      total,
		Page:       pagination.Page,
		PerPage:    pagination.PerPage,
		TotalPages: totalPages,
	}
}

func (fs *Store) GetFeedbackList(filters Filters, pagination PaginationParams) (*ListResponse, error) {
	var feedbacks []models.Feedback
	var total int64

	query := fs.db.Model(&models.Feedback{})
	query = applyFilters(query, filters)

	if err := query.Count(&total).Error; err != nil {
		return nil, fmt.Errorf("count feedback: %w", err)
	}

	if err := paginate(query.Order("created_at DESC"), pagination).Find(&feedbacks).Error; err != nil {
		return nil, fmt.Errorf("list feedback: %w", err)
	}

	return buildListResponse(feedbacks, total, pagination), nil
}

func (fs *Store) UpdateFeedback(id uint, updates map[string]interface{}) error {
	result := fs.db.Model(&models.Feedback{}).Where("id = ?", id).Updates(updates)
	if result.Error != nil {
		return fmt.Errorf("update feedback: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return errFeedbackNotFound
	}
	return nil
}

func (fs *Store) DeleteFeedback(id uint) error {
	result := fs.db.Delete(&models.Feedback{}, id)
	if result.Error != nil {
		return fmt.Errorf("delete feedback: %w", result.Error)
	}
	if result.RowsAffected == 0 {
		return errFeedbackNotFound
	}
	return nil
}

func (fs *Store) GetFeedbackStats() (map[string]int64, error) {
	var stats []struct {
		Status string
		Count  int64
	}

	if err := fs.db.Model(&models.Feedback{}).
		Select("status, COUNT(*) as count").
		Group("status").
		Scan(&stats).Error; err != nil {
		return nil, fmt.Errorf("get feedback stats: %w", err)
	}

	result := map[string]int64{"total": 0}
	for _, s := range stats {
		result[s.Status] = s.Count
		result["total"] += s.Count
	}
	return result, nil
}

func (fs *Store) GetUserFeedback(userID string, filters Filters, pagination PaginationParams) (*ListResponse, error) {
	filters.UserID = &userID
	return fs.GetFeedbackList(filters, pagination)
}

func (fs *Store) SearchFeedback(queryStr string, filters Filters, pagination PaginationParams) (*ListResponse, error) {
	var feedbacks []models.Feedback
	var total int64

	query := fs.db.Model(&models.Feedback{})
	if queryStr != "" {
		searchTerm := "%" + strings.ToLower(queryStr) + "%"
		query = query.Where("LOWER(subject) LIKE ? OR LOWER(message) LIKE ?", searchTerm, searchTerm)
	}
	query = applyFilters(query, filters)

	if err := query.Count(&total).Error; err != nil {
		return nil, fmt.Errorf("count search results: %w", err)
	}
	if err := paginate(query.Order("created_at DESC"), pagination).Find(&feedbacks).Error; err != nil {
		return nil, fmt.Errorf("search feedback: %w", err)
	}

	return buildListResponse(feedbacks, total, pagination), nil
}

// DeleteClosedOlderThan permanently deletes closed/resolved feedback older than the given number of days.
func (fs *Store) DeleteClosedOlderThan(days int) (int64, error) {
	result := fs.db.Unscoped().
		Where("status IN (?, ?) AND updated_at < NOW() - INTERVAL '1 day' * ?", "closed", "resolved", days).
		Delete(&models.Feedback{})
	if result.Error != nil {
		return 0, fmt.Errorf("cleanup old feedback: %w", result.Error)
	}
	return result.RowsAffected, nil
}
