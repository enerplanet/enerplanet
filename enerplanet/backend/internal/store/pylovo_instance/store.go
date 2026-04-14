package pylovoinstance

import (
	"fmt"
	"time"

	"spatialhub_backend/internal/models"

	"gorm.io/gorm"
)

type Store struct {
	db *gorm.DB
}

func NewStore(db *gorm.DB) *Store {
	return &Store{db: db}
}

func (s *Store) GetAll() ([]models.PylovoInstance, error) {
	var instances []models.PylovoInstance
	if err := s.db.Where("deleted_at IS NULL").Order("is_primary DESC, name ASC").Find(&instances).Error; err != nil {
		return nil, fmt.Errorf("get pylovo instances: %w", err)
	}
	return instances, nil
}

func (s *Store) GetByID(id uint) (*models.PylovoInstance, error) {
	var instance models.PylovoInstance
	if err := s.db.Where("id = ? AND deleted_at IS NULL", id).First(&instance).Error; err != nil {
		return nil, fmt.Errorf("get pylovo instance %d: %w", id, err)
	}
	return &instance, nil
}

func (s *Store) GetPrimary() (*models.PylovoInstance, error) {
	var instance models.PylovoInstance
	if err := s.db.Where("is_primary = true AND deleted_at IS NULL").First(&instance).Error; err != nil {
		return nil, fmt.Errorf("get primary pylovo instance: %w", err)
	}
	return &instance, nil
}

func (s *Store) Create(instance *models.PylovoInstance) error {
	if err := s.db.Create(instance).Error; err != nil {
		return fmt.Errorf("create pylovo instance: %w", err)
	}
	return nil
}

func (s *Store) Update(instance *models.PylovoInstance) error {
	if err := s.db.Save(instance).Error; err != nil {
		return fmt.Errorf("update pylovo instance %d: %w", instance.ID, err)
	}
	return nil
}

func (s *Store) Delete(id uint) error {
	now := time.Now()
	if err := s.db.Model(&models.PylovoInstance{}).Where("id = ? AND deleted_at IS NULL", id).Update("deleted_at", now).Error; err != nil {
		return fmt.Errorf("delete pylovo instance %d: %w", id, err)
	}
	return nil
}

func (s *Store) SetPrimary(id uint) error {
	return s.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.Model(&models.PylovoInstance{}).Where("deleted_at IS NULL").Update("is_primary", false).Error; err != nil {
			return fmt.Errorf("clear primary flag: %w", err)
		}
		if err := tx.Model(&models.PylovoInstance{}).Where("id = ? AND deleted_at IS NULL", id).Update("is_primary", true).Error; err != nil {
			return fmt.Errorf("set primary pylovo instance %d: %w", id, err)
		}
		return nil
	})
}

func (s *Store) UpdateAvailability(id uint, available bool) error {
	if err := s.db.Model(&models.PylovoInstance{}).Where("id = ? AND deleted_at IS NULL", id).Update("available", available).Error; err != nil {
		return fmt.Errorf("update availability for pylovo instance %d: %w", id, err)
	}
	return nil
}

func (s *Store) UpdateLastCheck(id uint) error {
	now := time.Now()
	if err := s.db.Model(&models.PylovoInstance{}).Where("id = ? AND deleted_at IS NULL", id).Update("last_check", now).Error; err != nil {
		return fmt.Errorf("update last check for pylovo instance %d: %w", id, err)
	}
	return nil
}

func (s *Store) GetSummary() (map[string]int64, error) {
	summary := map[string]int64{
		"total":     0,
		"active":    0,
		"available": 0,
	}

	base := s.db.Model(&models.PylovoInstance{}).Where("deleted_at IS NULL")

	var total, active, available int64
	if err := base.Count(&total).Error; err != nil {
		return nil, fmt.Errorf("count total: %w", err)
	}
	if err := s.db.Model(&models.PylovoInstance{}).Where("deleted_at IS NULL AND status = ?", "active").Count(&active).Error; err != nil {
		return nil, fmt.Errorf("count active: %w", err)
	}
	if err := s.db.Model(&models.PylovoInstance{}).Where("deleted_at IS NULL AND available = true").Count(&available).Error; err != nil {
		return nil, fmt.Errorf("count available: %w", err)
	}

	summary["total"] = total
	summary["active"] = active
	summary["available"] = available

	return summary, nil
}
