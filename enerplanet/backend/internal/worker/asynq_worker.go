package worker

import (
	"context"

	"github.com/hibiken/asynq"
	goredis "github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	"platform.local/platform/logger"
	"spatialhub_backend/internal/jobs"
	"spatialhub_backend/internal/services"
	"spatialhub_backend/internal/webservice"
)

type TaskProcessor struct {
	db                  *gorm.DB
	redis               *goredis.Client
	notificationService *services.NotificationService
	wsClient            *webservice.Client
}

func NewTaskProcessor(db *gorm.DB, redisClient *goredis.Client, notificationService *services.NotificationService, wsClient *webservice.Client) *TaskProcessor {
	return &TaskProcessor{
		db:                  db,
		redis:               redisClient,
		notificationService: notificationService,
		wsClient:            wsClient,
	}
}

func (p *TaskProcessor) ProcessTask(ctx context.Context, t *asynq.Task) error {
	log := logger.ForComponent("asynq_worker")

	switch t.Type() {
	case jobs.TypeBroadcastNotification:
		return jobs.HandleBroadcastNotification(ctx, t, p.db, p.redis)
	case jobs.TypeProcessResult:
		return jobs.HandleProcessResult(ctx, t, p.db, p.notificationService, p.wsClient)
	default:
		log.Errorf("unknown task type=%s", t.Type())
		return nil
	}
}
