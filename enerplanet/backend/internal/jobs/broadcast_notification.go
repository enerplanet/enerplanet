package jobs

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/hibiken/asynq"
	goredis "github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	backendModels "spatialhub_backend/internal/models"
	notificationStore "spatialhub_backend/internal/store/notification"

	"platform.local/platform/logger"
)

const (
	TypeBroadcastNotification = "broadcast_notification"
)

type BroadcastNotificationPayload struct {
	NotificationID uint `json:"notification_id"`
}

func HandleBroadcastNotification(ctx context.Context, t *asynq.Task, db *gorm.DB, redisClient *goredis.Client) error {
	log := logger.ForComponent("job:broadcast_notification")
	store := notificationStore.NewStore(db)

	var payload BroadcastNotificationPayload
	if err := json.Unmarshal(t.Payload(), &payload); err != nil {
		return fmt.Errorf("failed to unmarshal payload: %w", err)
	}

	// Get the notification
	notification, err := store.GetNotificationByID(payload.NotificationID)
	if err != nil {
		log.Errorf("failed to load notification notification_id=%d err=%v", payload.NotificationID, err)
		return fmt.Errorf("notification not found: %w", err)
	}

	// Get all users from user_settings
	userIDs, err := store.GetAllUserIDs()
	if err != nil {
		log.Errorf("failed to fetch users err=%v", err)
		return fmt.Errorf("failed to fetch users: %w", err)
	}

	// Create user notification for each user
	notifID := notification.ID
	successCount := 0
	failureCount := 0

	for _, uid := range userIDs {
		userNotif := backendModels.UserNotification{
			UserID:         uid,
			NotificationID: &notifID,
			Title:          "Maintenance Alert: " + notification.Service,
			Message:        notification.Message,
			Type:           notification.Type,
			Read:           false,
		}

		if err := store.CreateUserNotification(&userNotif); err != nil {
			log.Errorf("failed to create user notification for user_id=%s err=%v", uid, err)
			failureCount++
			continue
		}

		// Publish real-time event for this user if Redis is configured
		if redisClient != nil {
			// Ensure UTC format for timestamps
			const utcFormat = "2006-01-02T15:04:05Z"
			createdAtUTC := userNotif.CreatedAt.UTC().Format(utcFormat)
			scheduledAtUTC := notification.ScheduledAt.UTC().Format(utcFormat)

			// Build response payload compatible with frontend Notification type
			payload, _ := json.Marshal(map[string]any{
				"id":              userNotif.ID,
				"notification_id": userNotif.NotificationID,
				"title":           userNotif.Title,
				"message":         userNotif.Message,
				"type":            userNotif.Type,
				"read":            userNotif.Read,
				"created_at":      createdAtUTC,
				// service and scheduled_at can be included when available
				"service":      notification.Service,
				"scheduled_at": scheduledAtUTC,
			})
			channel := fmt.Sprintf("user_notifications:%s", uid)
			if err := redisClient.Publish(ctx, channel, payload).Err(); err != nil {
				log.Warnf("failed to publish realtime notification user_id=%s err=%v", uid, err)
			}
		}
		successCount++
	}

	if failureCount > 0 {
		return fmt.Errorf("broadcast completed with %d failures", failureCount)
	}

	return nil
}
