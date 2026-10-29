package jobs

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/hibiken/asynq"
	"github.com/sirupsen/logrus"
	"gorm.io/gorm"

	commonModels "platform.local/common/pkg/models"
	"platform.local/platform/logger"
	"spatialhub_backend/internal/city2tabula"
	"spatialhub_backend/internal/geo"
	"spatialhub_backend/internal/models"
)

// TypeTriggerCity2TabulaRun is the asynq task that starts a City2TABULA
// pipeline run for a model's polygon. Enqueued when a model is created or
// its coordinates change, so the 3D data is prepared ahead of the first
// calculation or per-building request. A run is not idempotent, so the task
// is enqueued without retries.
const TypeTriggerCity2TabulaRun = "trigger_city2tabula_run"

// TriggerCity2TabulaRunPayload is the trigger_city2tabula_run job payload.
type TriggerCity2TabulaRunPayload struct {
	ModelID uint `json:"model_id"`
}

// city2tabulaRunStore is the persistence surface the run trigger and
// run_buem's guard need. Satisfied by *c2trun.Store; faked in tests.
type city2tabulaRunStore interface {
	Save(modelID uint, runID, country, status string) error
	UpdateStatus(modelID uint, status, errMsg string) error
	Get(modelID uint) (*models.ModelCity2TabulaRun, error)
}

// HandleTriggerCity2TabulaRun starts a City2TABULA run for the model's
// polygon and records it. Nothing to do for a model without country or
// coordinates, or one using the estimate instead of BuEM. Failures are
// logged, not retried: run_buem still triggers a run itself when none is
// recorded.
func HandleTriggerCity2TabulaRun(ctx context.Context, t *asynq.Task, db *gorm.DB, c2t *city2tabula.Client, runs city2tabulaRunStore) error {
	log := logger.ForComponent("job:trigger_city2tabula_run")

	var p TriggerCity2TabulaRunPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("failed to unmarshal payload: %w", err)
	}
	var model commonModels.Model
	if err := db.First(&model, p.ModelID).Error; err != nil {
		return fmt.Errorf("failed to fetch model %d: %w", p.ModelID, err)
	}
	if ModelHeatSource(model.Config) == HeatSourceEstimate {
		log.Debugf("model %d: heatSource=estimate, no City2TABULA run needed", p.ModelID)
		return nil
	}
	if _, err := triggerAndRecordRun(ctx, log, c2t, runs, model); err != nil {
		log.Warnf("model %d: City2TABULA run not started: %v", p.ModelID, err)
	}
	return nil
}

// triggerAndRecordRun starts a run for model's polygon bbox and records it as
// the model's current run.
func triggerAndRecordRun(ctx context.Context, log *logrus.Entry, c2t *city2tabula.Client, runs city2tabulaRunStore, model commonModels.Model) (*city2tabula.Run, error) {
	if model.Country == nil || len(model.Coordinates) == 0 {
		return nil, fmt.Errorf("model %d has no country or coordinates", model.ID)
	}
	xmin, ymin, xmax, ymax, err := geo.BBoxFromGeoJSON(json.RawMessage(model.Coordinates))
	if err != nil {
		return nil, fmt.Errorf("model %d: bbox from coordinates: %w", model.ID, err)
	}
	run, err := c2t.TriggerRun(ctx, *model.Country, city2tabula.Bbox{Xmin: xmin, Ymin: ymin, Xmax: xmax, Ymax: ymax})
	if err != nil {
		return nil, err
	}
	if runs != nil {
		if err := runs.Save(model.ID, run.RunID, *model.Country, run.Status); err != nil {
			log.Errorf("model %d: failed to record City2TABULA run %s: %v", model.ID, run.RunID, err)
		}
	}
	log.Infof("model %d: City2TABULA run %s started (%s)", model.ID, run.RunID, run.Status)
	return run, nil
}

// RefreshCity2TabulaRun returns the model's recorded run with its status
// brought up to date from City2TABULA when it was not yet finished, or nil
// when no run was recorded. A later per-building request uses it to answer
// "not ready" while the run is still going.
func RefreshCity2TabulaRun(ctx context.Context, c2t *city2tabula.Client, runs city2tabulaRunStore, modelID uint) (*models.ModelCity2TabulaRun, error) {
	rec, err := runs.Get(modelID)
	if err != nil || rec == nil || models.City2TabulaRunFinished(rec.Status) {
		return rec, err
	}
	run, err := c2t.GetRunStatus(ctx, rec.RunID)
	if err != nil {
		return rec, err
	}
	rec.Status = run.Status
	if err := runs.UpdateStatus(modelID, run.Status, run.Error); err != nil {
		return rec, err
	}
	return rec, nil
}
