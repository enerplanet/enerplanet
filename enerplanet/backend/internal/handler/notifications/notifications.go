package notifications

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/hibiken/asynq"
	goredis "github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	"platform.local/common/pkg/httputil"
	platformlogger "platform.local/platform/logger"
	backendModels "spatialhub_backend/internal/models"
	notificationStore "spatialhub_backend/internal/store/notification"
)

const (
	timestampFormat = "2006-01-02T15:04:05Z"
)

func formatAsUTC(t time.Time) string {
	// If the time is in the future, it's likely a local time stored as UTC (GORM issue with timestamp without timezone)
	// We try to reinterpret it as local time to get the correct UTC time.
	if t.After(time.Now().UTC()) {
		tLocal := time.Date(t.Year(), t.Month(), t.Day(), t.Hour(), t.Minute(), t.Second(), t.Nanosecond(), time.Local)
		return tLocal.UTC().Format(timestampFormat)
	}
	return t.UTC().Format(timestampFormat)
}

type Handler struct {
	store       *notificationStore.Store
	asynqClient *asynq.Client
	redisClient *goredis.Client
}

func NewHandlerWithAsynqAndRedis(db *gorm.DB, asynqClient *asynq.Client, redisClient *goredis.Client) *Handler {
	return &Handler{
		store:       notificationStore.NewStore(db),
		asynqClient: asynqClient,
		redisClient: redisClient,
	}
}

type SendNotificationRequest struct {
	Service       string `json:"service" binding:"required"`
	ScheduledDate string `json:"scheduled_date" binding:"required"`
	ScheduledTime string `json:"scheduled_time" binding:"required"`
	Message       string `json:"message" binding:"required"`
	Type          string `json:"type" binding:"required"`
}

type NotificationResponse struct {
	ID        uint   `json:"id"`
	Service   string `json:"service"`
	Message   string `json:"message"`
	Type      string `json:"type"`
	CreatedBy string `json:"created_by"`
	CreatedAt string `json:"created_at"`
}

type UserNotificationResponse struct {
	ID             uint    `json:"id"`
	Title          string  `json:"title"`
	Message        string  `json:"message"`
	Type           string  `json:"type"`
	Read           bool    `json:"read"`
	CreatedAt      string  `json:"created_at"`
	Service        *string `json:"service,omitempty"`
	ScheduledAt    *string `json:"scheduled_at,omitempty"`
	NotificationID *uint   `json:"notification_id,omitempty"`
}

// SendNotification schedules a notification (expert only)
func (h *Handler) SendNotification(c *gin.Context) {
	userID, ok := httputil.MustGetUserID(c)
	if !ok {
		return
	}

	accessLevel, exists := c.Get("access_level")
	if !exists || accessLevel != "expert" {
		httputil.Forbidden(c, "Only expert users can send notifications")
		return
	}

	var req SendNotificationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		httputil.BadRequest(c, err.Error())
		return
	}

	scheduledDateTime, err := time.Parse("2006-01-02 15:04", req.ScheduledDate+" "+req.ScheduledTime)
	if err != nil {
		httputil.BadRequestWithDetails(c, "Invalid date/time format", err.Error())
		return
	}

	notification := backendModels.Notification{
		Service:       req.Service,
		Message:       req.Message,
		Type:          req.Type,
		ScheduledAt:   scheduledDateTime,
		CreatedBy:     userID,
		Status:        "pending",
		RecipientType: "all",
		CreatedAt:     time.Now().UTC(),
	}

	if err := h.store.CreateNotification(&notification); err != nil {
		httputil.InternalErrorWithDetails(c, "Failed to create notification", err.Error())
		return
	}

	if h.asynqClient != nil {
		payload, _ := json.Marshal(map[string]interface{}{
			"notification_id": notification.ID,
		})
		task := asynq.NewTask("broadcast_notification", payload)
		_, err := h.asynqClient.Enqueue(task, asynq.Queue("notifications"))
		if err != nil {
			httputil.InternalErrorWithDetails(c, "Warning: Notification created but queueing failed", err.Error())
			return
		}
	} else {
		go h.broadcastNotification(notification)
	}

	httputil.SuccessResponse(c, gin.H{
		"message": "Notification scheduled successfully",
		"notification": NotificationResponse{
			ID:        notification.ID,
			Service:   notification.Service,
			Message:   notification.Message,
			Type:      notification.Type,
			CreatedBy: notification.CreatedBy,
			CreatedAt: formatAsUTC(notification.CreatedAt),
		},
	})
}

// broadcastNotification persists user notifications for all users
func (h *Handler) broadcastNotification(notification backendModels.Notification) {
	userIDs, _ := h.store.GetAllUserIDs()

	notifID := notification.ID
	for _, uid := range userIDs {
		userNotif := backendModels.UserNotification{
			UserID:         uid,
			NotificationID: &notifID,
			Title:          "Maintenance Alert: " + notification.Service,
			Message:        notification.Message,
			Type:           notification.Type,
			Read:           false,
			CreatedAt:      time.Now().UTC(),
		}
		h.store.CreateUserNotification(&userNotif)
	}
}

// StreamNotifications streams user notifications via Server-Sent Events (SSE).
// Redis pub/sub is required for realtime notifications.
func (h *Handler) StreamNotifications(c *gin.Context) {
	userID, ok := httputil.MustGetUserID(c)
	if !ok {
		return
	}

	log := platformlogger.ForComponent("notifications_stream")

	if h.redisClient == nil {
		log.Error("Redis client is nil, cannot stream notifications")
		httputil.InternalError(c, "Realtime notifications not available")
		return
	}

	if err := h.streamWithRedis(c, userID); err != nil && !errors.Is(err, context.Canceled) {
		log.WithError(err).Errorf("Redis stream failed for user_id=%s", userID)
	}
}

func (h *Handler) streamWithRedis(c *gin.Context, userID string) error {
	if h.redisClient == nil {
		return fmt.Errorf("redis client not configured")
	}

	// Disable the server-level write timeout for this SSE connection
	// so it can stay open indefinitely without being killed.
	rc := http.NewResponseController(c.Writer)
	_ = rc.SetWriteDeadline(time.Time{})

	ctx := c.Request.Context()
	channel := fmt.Sprintf("user_notifications:%s", userID)

	pubsub := h.redisClient.Subscribe(ctx, channel)
	defer func() {
		_ = pubsub.Close()
	}()

	if _, err := pubsub.Receive(ctx); err != nil {
		return err
	}

	ch := pubsub.Channel()

	// Set SSE headers
	c.Writer.Header().Set("Content-Type", "text/event-stream")
	c.Writer.Header().Set("Cache-Control", "no-cache")
	c.Writer.Header().Set("Connection", "keep-alive")
	c.Writer.Header().Set("X-Accel-Buffering", "no")
	c.Writer.Header().Set("Transfer-Encoding", "chunked")

	// Get the flusher
	flusher, ok := c.Writer.(http.Flusher)
	if !ok {
		return fmt.Errorf("streaming not supported")
	}

	// Send initial connected event
	fmt.Fprintf(c.Writer, "event: connected\ndata: %s\n\n",
		`{"status":"ok","channel":"`+channel+`","user_id":"`+userID+`"}`)
	flusher.Flush()

	// Heartbeat ticker to keep connection alive (every 15 seconds)
	heartbeat := time.NewTicker(15 * time.Second)
	defer heartbeat.Stop()

	for {
		select {
		case <-ctx.Done():
			return nil
		case <-heartbeat.C:
			// Send SSE comment as heartbeat
			if _, err := fmt.Fprintf(c.Writer, ": heartbeat %s\n\n", time.Now().UTC().Format(time.RFC3339)); err != nil {
				return nil
			}
			flusher.Flush()
		case msg, ok := <-ch:
			if !ok {
				return nil
			}
			if _, err := fmt.Fprintf(c.Writer, "event: notification\ndata: %s\n\n", msg.Payload); err != nil {
				return nil
			}
			flusher.Flush()
		}
	}
}

func (h *Handler) GetUserNotifications(c *gin.Context) {
	userID, ok := httputil.MustGetUserID(c)
	if !ok {
		return
	}

	last30Days := c.Query("last30Days")

	var cutoff time.Time
	if last30Days == "true" {
		cutoff = time.Now().UTC().AddDate(0, 0, -30)
	}

	userNotifications, err := h.store.GetUserNotifications(userID, 50, cutoff)
	if err != nil {
		httputil.InternalError(c, "Failed to fetch notifications")
		return
	}

	response := make([]UserNotificationResponse, 0, len(userNotifications))
	for _, un := range userNotifications {
		resp := UserNotificationResponse{
			ID:             un.ID,
			Title:          un.Title,
			Message:        un.Message,
			Type:           un.Type,
			Read:           un.Read,
			CreatedAt:      formatAsUTC(un.CreatedAt),
			NotificationID: un.NotificationID,
		}

		if un.NotificationID != nil {
			if notification, err := h.store.GetNotificationByID(*un.NotificationID); err == nil {
				resp.Service = &notification.Service
				scheduledAt := formatAsUTC(notification.ScheduledAt)
				resp.ScheduledAt = &scheduledAt
			}
		}

		response = append(response, resp)
	}

	c.JSON(200, gin.H{
		"success":       true,
		"notifications": response,
	})
}

// MarkAsRead marks one notification as read
func (h *Handler) MarkAsRead(c *gin.Context) {
	userID, ok := httputil.MustGetUserID(c)
	if !ok {
		return
	}

	notificationID := c.Param("id")

	// Parse the notification ID string to uint
	var id uint
	if _, err := fmt.Sscanf(notificationID, "%d", &id); err != nil {
		httputil.BadRequest(c, "Invalid notification ID")
		return
	}

	_, err := h.store.MarkAsRead(id, userID)
	if err != nil {
		httputil.InternalError(c, "Failed to update notification")
		return
	}

	httputil.SuccessMessage(c, "Notification marked as read")
}

// MarkAllAsRead marks all notifications as read
func (h *Handler) MarkAllAsRead(c *gin.Context) {
	userID, ok := httputil.MustGetUserID(c)
	if !ok {
		return
	}

	_, err := h.store.MarkAllAsRead(userID)
	if err != nil {
		httputil.InternalError(c, "Failed to update notifications")
		return
	}

	httputil.SuccessMessage(c, "All notifications marked as read")
}

// ClearAllNotifications deletes all notifications for the user
func (h *Handler) ClearAllNotifications(c *gin.Context) {
	userID, ok := httputil.MustGetUserID(c)
	if !ok {
		return
	}

	_, err := h.store.ClearAllUserNotifications(userID)
	if err != nil {
		httputil.InternalError(c, "Failed to clear notifications")
		return
	}

	httputil.SuccessMessage(c, "All notifications cleared")
}
