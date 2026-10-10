package jobs

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"platform.local/platform/logger"
	"spatialhub_backend/internal/models"
	resultservice "spatialhub_backend/internal/result/service"
)

// TypeIngestMemePyPSAResult is the asynq task type for the isolated PyPSA
// ingest: parsing an already-stored MEME `meme-pypsa` bundle's power-flow
// files into the electrical R2 tables and setting the capability source to
// full-grid-pf. It is a distinct task from the PyPSA dispatch (which only
// stores the zip), mirroring how the Calliope ingest is split from its
// dispatch.
const TypeIngestMemePyPSAResult = "ingest_meme_pypsa_result"

// IngestMemePyPSAResultPayload identifies a stored PyPSA result zip to ingest.
// ZipPath is the resolved path from ResultZipStore.SaveZIP.
type IngestMemePyPSAResultPayload struct {
	ModelID uint   `json:"model_id"`
	UserID  string `json:"user_id"`
	ZipPath string `json:"zip_path"`
}

// HandleIngestMemePyPSAResult runs the isolated PyPSA bundle ingest EXACTLY
// ONCE, updating the model's PYPSA-leg MEME run lifecycle:
//   - success -> status MemeRunStatusCompleted (pypsa leg), model completed;
//   - failure -> status MemeRunStatusFailed (pypsa leg), model failed, error
//     returned so the surface reports it (zero masking).
//
// A non-convergent PF (or a bundle whose PF exports were cleared) is a NORMAL
// outcome: the resultservice ingest records it and still returns success, so
// the model completes with only the electrical sections gated off — mirroring
// the legacy "clearing bad results" convergence guard. The task is enqueued
// with MaxRetry(0) (see asynqIngestMemePyPSAEnqueuer): parsed once, reported
// once, never masked by retry-with-backoff.
func HandleIngestMemePyPSAResult(ctx context.Context, t *asynq.Task, db *gorm.DB, runs memeLegRunStore, ingester resultservice.PyPSAIngester) (retErr error) {
	log := logger.ForComponent("job:ingest_meme_pypsa_result")

	defer func() {
		if r := recover(); r != nil {
			log.Errorf("PANIC in HandleIngestMemePyPSAResult: %v", r)
			retErr = fmt.Errorf("panic in ingest_meme_pypsa_result: %v", r)
		}
	}()

	var p IngestMemePyPSAResultPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("failed to unmarshal ingest_meme_pypsa_result payload: %w", err)
	}

	if _, err := ingester.IngestPyPSAResult(ctx, p.ModelID, p.UserID, p.ZipPath); err != nil {
		// Zero masking: record the terminal 'failed' state with the actual cause
		// and return it so it surfaces exactly once.
		if uerr := runs.UpdateStatusLeg(p.ModelID, models.MemeLegPyPSA, models.MemeRunStatusFailed, err.Error()); uerr != nil {
			log.Errorf("model %d: failed to mark MEME pypsa run failed: %v", p.ModelID, uerr)
		}
		markModelFailed(db, p.ModelID, err.Error())
		return fmt.Errorf("ingest MEME pypsa result model_id=%d zip=%s: %w", p.ModelID, p.ZipPath, err)
	}

	// Success: the isolated PyPSA leg (dispatch + ingest) is done. Clearing the
	// error restores a pypsa leg a prior failed parse had flipped to 'failed'.
	if err := runs.UpdateStatusLeg(p.ModelID, models.MemeLegPyPSA, models.MemeRunStatusCompleted, ""); err != nil {
		log.Errorf("model %d: failed to mark MEME pypsa run completed: %v", p.ModelID, err)
	}
	markModelCompleted(db, p.ModelID)
	return nil
}

// IngestMemePyPSAEnqueuer enqueues the ingest_meme_pypsa_result asynq job for a
// stored zip. It is an interface so the dispatch handler can be tested without
// Redis (mirrors IngestMemeEnqueuer).
type IngestMemePyPSAEnqueuer interface {
	EnqueueIngestMemePyPSA(ctx context.Context, p IngestMemePyPSAResultPayload) error
}

// asynqIngestMemePyPSAEnqueuer enqueues the ingest job through the asynq client.
type asynqIngestMemePyPSAEnqueuer struct {
	client *asynq.Client
}

// NewAsynqIngestMemePyPSAEnqueuer returns an IngestMemePyPSAEnqueuer backed by asynq.
func NewAsynqIngestMemePyPSAEnqueuer(client *asynq.Client) IngestMemePyPSAEnqueuer {
	return &asynqIngestMemePyPSAEnqueuer{client: client}
}

func (e *asynqIngestMemePyPSAEnqueuer) EnqueueIngestMemePyPSA(ctx context.Context, p IngestMemePyPSAResultPayload) error {
	body, err := json.Marshal(p)
	if err != nil {
		return err
	}
	task := asynq.NewTask(TypeIngestMemePyPSAResult, body)
	// Parse exactly once: MaxRetry(0) reports a failure once instead of masking
	// it with retry-with-backoff (see HandleIngestMemePyPSAResult).
	_, err = e.client.EnqueueContext(ctx, task, asynq.Queue("results"), asynq.MaxRetry(0))
	return err
}
