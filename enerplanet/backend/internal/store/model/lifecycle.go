package model

import (
	"context"
	"encoding/json"
	"time"

	"gorm.io/datatypes"
	"gorm.io/gorm"

	"spatialhub_backend/internal/events"

	"platform.local/common/pkg/contracts"
	commonModels "platform.local/common/pkg/models"
)

// Lifecycle transition result.
type LifecycleTransition struct {
	Status  string
	Applied bool
}

// Claims queued model.
func (s *Store) ClaimRunning(ctx context.Context, modelID, webserviceID uint, now time.Time) (LifecycleTransition, error) {
	event, err := events.NewModelEvent(events.ModelRunning, modelID, "", map[string]interface{}{
		"webservice_id": webserviceID,
	})
	if err != nil {
		return LifecycleTransition{}, err
	}

	var transition LifecycleTransition
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&commonModels.Model{}).
			Where("id = ? AND status = ?", modelID, commonModels.ModelStatusQueue).
			Updates(map[string]interface{}{
				"status":                   commonModels.ModelStatusRunning,
				"webservice_id":            webserviceID,
				"calculation_started_at":   now,
				"calculation_completed_at": nil,
				"updated_at":               now,
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 1 {
			transition = LifecycleTransition{Status: commonModels.ModelStatusRunning, Applied: true}
			return events.EnqueueTx(tx, event)
		}

		// Handles ineligible model.
		transition = LifecycleTransition{}
		return nil
	})
	if err != nil {
		return LifecycleTransition{}, err
	}
	return transition, nil
}

// Marks model failed.
func (s *Store) MarkFailed(ctx context.Context, modelID uint, reason string, now time.Time) (LifecycleTransition, error) {
	resultJSON, err := json.Marshal(map[string]string{"error": reason})
	if err != nil {
		return LifecycleTransition{}, err
	}
	event, err := events.NewModelEvent(events.ModelFailed, modelID, "", map[string]interface{}{
		"reason": reason,
	})
	if err != nil {
		return LifecycleTransition{}, err
	}

	var transition LifecycleTransition
	err = s.db.WithContext(ctx).Transaction(func(tx *gorm.DB) error {
		result := tx.Model(&commonModels.Model{}).
			Where("id = ? AND status IN ?", modelID, []string{
				commonModels.ModelStatusQueue,
				commonModels.ModelStatusRunning,
			}).
			Updates(map[string]interface{}{
				"status":                   commonModels.ModelStatusFailed,
				"webservice_id":            nil,
				"calculation_completed_at": now,
				"updated_at":               now,
				"results":                  datatypes.JSON(resultJSON),
			})
		if result.Error != nil {
			return result.Error
		}
		if result.RowsAffected == 1 {
			transition = LifecycleTransition{Status: commonModels.ModelStatusFailed, Applied: true}
			return events.EnqueueTx(tx, event)
		}

		transition = LifecycleTransition{Status: commonModels.ModelStatusFailed}
		return nil
	})
	if err != nil {
		return LifecycleTransition{}, err
	}
	return transition, nil
}

// Updates run session.
func (s *Store) UpdateRunSession(ctx context.Context, modelID uint, sessionID *int64, callbackURL *string, now time.Time) (string, error) {
	updates := map[string]interface{}{"updated_at": now}
	if sessionID != nil {
		updates["session_id"] = *sessionID
	}
	if callbackURL != nil {
		updates["callback_url"] = *callbackURL
	}

	result := s.db.WithContext(ctx).
		Model(&commonModels.Model{}).
		Where("id = ?", modelID).
		Updates(updates)
	if result.Error != nil {
		return "", result.Error
	}

	return currentModelStatus(ctx, s.db, modelID)
}

// Lists active models.
func (s *Store) ListActiveModels(ctx context.Context) ([]contracts.ActiveModel, error) {
	models := make([]contracts.ActiveModel, 0)
	err := s.db.WithContext(ctx).
		Model(&commonModels.Model{}).
		Select("id AS model_id, webservice_id, status, calculation_started_at").
		Where("status IN ?", []string{
			commonModels.ModelStatusQueue,
			commonModels.ModelStatusRunning,
		}).
		Order("id ASC").
		Scan(&models).Error
	return models, err
}

func currentModelStatus(ctx context.Context, db *gorm.DB, modelID uint) (string, error) {
	var row struct {
		Status string
	}
	err := db.WithContext(ctx).
		Model(&commonModels.Model{}).
		Select("status").
		Where("id = ?", modelID).
		Take(&row).Error
	return row.Status, err
}
