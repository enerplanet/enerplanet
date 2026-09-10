package worker

import (
	"context"

	"github.com/hibiken/asynq"
	goredis "github.com/redis/go-redis/v9"
	"gorm.io/gorm"

	"platform.local/platform/logger"
	"spatialhub_backend/internal/buem"
	"spatialhub_backend/internal/city2tabula"
	"spatialhub_backend/internal/ignis"
	"spatialhub_backend/internal/jobs"
	"spatialhub_backend/internal/services"
	"spatialhub_backend/internal/store/c2trun"
	"spatialhub_backend/internal/store/demandprofile"
	weatherclient "spatialhub_backend/internal/weather"
	"spatialhub_backend/internal/webservice"
)

type TaskProcessor struct {
	db                  *gorm.DB
	redis               *goredis.Client
	notificationService *services.NotificationService
	wsClient            *webservice.Client
	asynqClient         *asynq.Client
	city2tabulaClient   *city2tabula.Client
	weatherClient       *weatherclient.Client
	weatherProvider     string
	buemClient          *buem.Client
	ignisClient         *ignis.Client
	profileStore        *demandprofile.Store
	c2tRuns             *c2trun.Store
}

func NewTaskProcessor(
	db *gorm.DB,
	redisClient *goredis.Client,
	notificationService *services.NotificationService,
	wsClient *webservice.Client,
	asynqClient *asynq.Client,
	city2tabulaClient *city2tabula.Client,
	weatherClient *weatherclient.Client,
	weatherProvider string,
	buemClient *buem.Client,
	ignisClient *ignis.Client,
) *TaskProcessor {
	return &TaskProcessor{
		db:                  db,
		redis:               redisClient,
		notificationService: notificationService,
		wsClient:            wsClient,
		asynqClient:         asynqClient,
		city2tabulaClient:   city2tabulaClient,
		weatherClient:       weatherClient,
		weatherProvider:     weatherProvider,
		buemClient:          buemClient,
		ignisClient:         ignisClient,
		profileStore:        demandprofile.NewStore(db),
		c2tRuns:             c2trun.NewStore(db),
	}
}

func (p *TaskProcessor) ProcessTask(ctx context.Context, t *asynq.Task) error {
	log := logger.ForComponent("asynq_worker")

	switch t.Type() {
	case jobs.TypeBroadcastNotification:
		return jobs.HandleBroadcastNotification(ctx, t, p.db, p.redis)
	case jobs.TypeProcessResult:
		return jobs.HandleProcessResult(ctx, t, p.db, p.notificationService, p.wsClient)
	case jobs.TypeRunBuem:
		return jobs.HandleRunBuem(ctx, t, p.db, p.city2tabulaClient, p.c2tRuns, p.weatherClient, p.weatherProvider, p.buemClient, p.ignisClient, p.asynqClient, p.notificationService)
	case jobs.TypeResolveDemandProfiles:
		return jobs.HandleResolveDemandProfiles(ctx, t, p.db, p.city2tabulaClient, p.c2tRuns, p.weatherClient, p.weatherProvider, p.ignisClient, p.buemClient, p.profileStore)
	case jobs.TypeTriggerCity2TabulaRun:
		return jobs.HandleTriggerCity2TabulaRun(ctx, t, p.db, p.city2tabulaClient, p.c2tRuns)
	case jobs.TypeDomainEvent:
		return jobs.HandleDomainEvent(ctx, t)
	default:
		log.Errorf("unknown task type=%s", t.Type())
		return nil
	}
}
