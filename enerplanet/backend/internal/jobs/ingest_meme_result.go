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

// TypeIngestMemeResult is the asynq task type for Step 6's ingest: parsing an
// already-stored MEME result zip's per-target output through Coati and loading
// it into the R2 result tables. It is a distinct task from dispatch so the
// dispatch handler (which only stores the zip) stays a thin, easily-tested
// producer.
const TypeIngestMemeResult = "ingest_meme_result"

// IngestMemeResultPayload identifies a stored result zip to ingest. ZipPath is
// the resolved path from ResultZipStore.SaveZIP.
type IngestMemeResultPayload struct {
	ModelID uint   `json:"model_id"`
	UserID  string `json:"user_id"`
	ZipPath string `json:"zip_path"`
}

// HandleIngestMemeResult runs the Coati ingest over a stored zip EXACTLY ONCE,
// updating the model's MEME run lifecycle (Step 6, simplified design):
//   - success -> status MemeRunStatusCompleted (clears any prior error), nil;
//   - failure -> status MemeRunStatusFailed with the captured error, and the
//     error is returned so the surface reports it (zero masking).
//
// The task is enqueued with MaxRetry(0) (see EnqueueIngestMeme): a parse failure
// is reported once, never retried-with-backoff, so a real error can't be hidden.
// A failed parse is terminal; the only rerun is a user-initiated re-solve via
// StartCalculation, which re-dispatches MEME fresh (never resumes a partial run).
func HandleIngestMemeResult(ctx context.Context, t *asynq.Task, db *gorm.DB, runs memeRunStore, runner resultservice.CoatiRunner) (retErr error) {
	log := logger.ForComponent("job:ingest_meme_result")

	defer func() {
		if r := recover(); r != nil {
			log.Errorf("PANIC in HandleIngestMemeResult: %v", r)
			retErr = fmt.Errorf("panic in ingest_meme_result: %v", r)
		}
	}()

	var p IngestMemeResultPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("failed to unmarshal ingest_meme_result payload: %w", err)
	}

	if _, err := resultservice.NewResultService(db).IngestCoatiResult(ctx, p.ModelID, p.UserID, p.ZipPath, runner); err != nil {
		// Zero masking: record the terminal 'failed' state with the actual cause
		// and return the error so it is surfaced exactly once. Coati's own error
		// already distinguishes parse failure from CLI-missing ('coati binary not
		// found: set COATI_BIN...', 'coati convert <file>: exit...: <stderr>',
		// 'produced empty output') — carry it verbatim.
		if uerr := runs.UpdateStatus(p.ModelID, models.MemeRunStatusFailed, err.Error()); uerr != nil {
			log.Errorf("model %d: failed to mark MEME run failed: %v", p.ModelID, uerr)
		}
		markModelFailed(db, p.ModelID, err.Error())
		return fmt.Errorf("ingest MEME result model_id=%d zip=%s: %w", p.ModelID, p.ZipPath, err)
	}

	// Success: the full pipeline (dispatch + ingest) is done. Clearing the error
	// restores a run that a prior failed parse had flipped to 'failed' (only a
	// user re-solve reaches this via a fresh dispatch + ingest).
	if err := runs.UpdateStatus(p.ModelID, models.MemeRunStatusCompleted, ""); err != nil {
		log.Errorf("model %d: failed to mark MEME run completed: %v", p.ModelID, err)
	}
	markModelCompleted(db, p.ModelID)
	return nil
}

// IngestMemeEnqueuer enqueues the ingest_meme_result asynq job for a stored
// zip. It is an interface so the dispatch handler can be tested without Redis.
type IngestMemeEnqueuer interface {
	EnqueueIngestMeme(ctx context.Context, p IngestMemeResultPayload) error
}

// asynqIngestMemeEnqueuer enqueues the ingest job through the asynq client.
type asynqIngestMemeEnqueuer struct {
	client *asynq.Client
}

// NewAsynqIngestMemeEnqueuer returns an IngestMemeEnqueuer backed by asynq.
func NewAsynqIngestMemeEnqueuer(client *asynq.Client) IngestMemeEnqueuer {
	return &asynqIngestMemeEnqueuer{client: client}
}

func (e *asynqIngestMemeEnqueuer) EnqueueIngestMeme(ctx context.Context, p IngestMemeResultPayload) error {
	body, err := json.Marshal(p)
	if err != nil {
		return err
	}
	task := asynq.NewTask(TypeIngestMemeResult, body)
	// Parse exactly once: MaxRetry(0) reports a failure once instead of masking
	// it with retry-with-backoff. A failed parse is terminal; the only rerun is
	// a user re-solve (a fresh dispatch, which re-enqueues a new ingest).
	_, err = e.client.EnqueueContext(ctx, task, asynq.Queue("results"), asynq.MaxRetry(0))
	return err
}