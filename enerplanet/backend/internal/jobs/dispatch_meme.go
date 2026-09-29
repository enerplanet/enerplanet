package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"spatialhub_backend/internal/meme"
	"spatialhub_backend/internal/models"
	"spatialhub_backend/internal/payload"
	tentacronclient "spatialhub_backend/internal/tentacron"

	commonModels "platform.local/common/pkg/models"
	"platform.local/platform/logger"
)

// TypeDispatchMeme is the asynq task type for the backend's native MEME
// dispatch (the first real caller of the T1K seam).
const TypeDispatchMeme = "dispatch_meme"

// memeTarget is the TentaCron target that forwards to MEME. It is hard-fixed
// upstream (see the tentacron skill); the backend just names it.
const memeTarget = "meme"

// memePollBudget is how long a MEME dispatch may stay alive waiting for the
// job. It matches TentaCron's own meme target poll timeout (30m), NOT the
// backend's generic 60s opTimeout: a MEME solve takes minutes, and a too-short
// deadline would error, trigger a asynq retry, and enqueue a duplicate.
const memePollBudget = 30 * time.Minute

// memeIdempotencyKey is the Idempotency-Key sent with a fresh MEME submit so a
// resubmit (e.g. a retry racing the persist) returns the stored TentaCron job
// instead of enqueuing a duplicate. It is per-model: TentaCron keys on
// key+payload, and the payload is a function of that model.
func memeIdempotencyKey(modelID uint) string {
	return fmt.Sprintf("model_%d", modelID)
}

// memeRunStore is the persistence surface for a model's TentaCron MEME job id.
// Satisfied by *memerun.Store; faked in tests.
type memeRunStore interface {
	Save(modelID uint, runID, status string) error
	UpdateStatus(modelID uint, status, errMsg string) error
	Get(modelID uint) (*models.ModelMemeRun, error)
}

// DispatchMemePayload mirrors the run_buem payload pattern but only needs the
// identity of the model: the model is loaded fresh so its config, country and
// dates are current at dispatch time (matching how StartCalculation resolved
// them for the legacy webservice path).
type DispatchMemePayload struct {
	ModelID uint   `json:"model_id"`
	UserID  string `json:"user_id"`
}

// HandleDispatchMeme is the backend's native MEME calculation path: it builds
// the model's calculation payload, translates it to a MEME job via the T1K
// seam (electricity-only for now; heat is tracked in tasks/heat-patch.md),
// submits it over TentaCron's "meme" target, and persists the result zip.
//
// TentaCron is itself the durable single-instance SQLite queue (ADR-0002) and
// polls MEME to completion (response.mode: poll, ADR-0004); the produced job
// bytes are set via meme.TranslatePayload (the T1K seam) and never unmarshaled
// into internal/meme/job.go's lossy typed Job struct. This handler therefore:
//   - submits ONCE with an Idempotency-Key, captures the TentaCron job id, and
//     persists it per model (model_meme_runs) so a later retry/re-run resumes
//     by id instead of resubmitting (no duplicate MEME enqueues);
//   - long-polls by id on memePollBudget (NOT the 60s default opTimeout);
//   - reads the raw result via GET /v1/requests/{id}/result (binary zip);
//   - stores it through the swap-pable ResultZipStore.
func HandleDispatchMeme(
	ctx context.Context,
	t *asynq.Task,
	db *gorm.DB,
	tc *tentacronclient.Client,
	runs memeRunStore,
	store ResultZipStore,
) (retErr error) {
	log := logger.ForComponent("job:dispatch_meme")

	defer func() {
		if r := recover(); r != nil {
			log.Errorf("PANIC in HandleDispatchMeme: %v", r)
			retErr = fmt.Errorf("panic in dispatch_meme: %v", r)
		}
	}()

	var p DispatchMemePayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("failed to unmarshal dispatch_meme payload: %w", err)
	}

	var model commonModels.Model
	if err := db.First(&model, p.ModelID).Error; err != nil {
		return fmt.Errorf("failed to fetch model %d: %w", p.ModelID, err)
	}

	// 1. Build the calculation payload from the stored model.
	built, err := payload.BuildCalculationPayload(&model)
	if err != nil {
		return fmt.Errorf("build calculation payload for model %d: %w", p.ModelID, err)
	}
	calcBytes, err := json.Marshal(built)
	if err != nil {
		return fmt.Errorf("marshal calculation payload for model %d: %w", p.ModelID, err)
	}

	// 2. Translate the payload into a MEME job via the T1K seam.
	translated, err := meme.TranslatePayload(calcBytes)
	if err != nil {
		return fmt.Errorf("translate payload to MEME job for model %d: %w", p.ModelID, err)
	}

	// 3. Resolve the TentaCron job id, resuming an in-flight one by id.
	//    Only submit fresh, with an Idempotency-Key, when no job is recorded.
	var memeJob any
	if err := json.Unmarshal(translated.Job, &memeJob); err != nil {
		return fmt.Errorf("decode translated MEME job for model %d: %w", p.ModelID, err)
	}

	rec, err := runs.Get(p.ModelID)
	if err != nil {
		return fmt.Errorf("load MEME run for model %d: %w", p.ModelID, err)
	}
	jobID := ""
	submittedNow := false
	switch {
	case rec == nil:
		jobID, err = tc.SubmitMeme(ctx, memeTarget, memeJob, memeIdempotencyKey(model.ID))
		if err != nil {
			return fmt.Errorf("meme dispatch via TentaCron for model %d: %w", p.ModelID, err)
		}
		if err := runs.Save(p.ModelID, jobID, "running"); err != nil {
			log.Errorf("model %d: failed to persist MEME TentaCron job %s: %v", p.ModelID, jobID, err)
		}
		submittedNow = true
		log.Infof("model %d: submitted MEME job to TentaCron id=%s", p.ModelID, jobID)
	case models.MemeRunFinished(rec.Status):
		// Terminal outcome already recorded; resume-by-id to re-read the stored
		// result for this run (idempotent re-run), never resubmit.
		jobID = rec.RunID
		log.Infof("model %d: resuming terminal MEME TentaCron job id=%s (idempotent re-run)", p.ModelID, jobID)
	default:
		// A run is recorded and still alive: resume it by id, never resubmit.
		jobID = rec.RunID
		log.Infof("model %d: resuming existing MEME TentaCron job id=%s (no resubmit)", p.ModelID, jobID)
	}

	// 4. Long-poll by id on the meme budget, then read the raw zip via /result.
	if err := tc.AwaitResultByID(ctx, jobID, memePollBudget); err != nil {
		return fmt.Errorf("meme job %s via TentaCron for model %d: %w", jobID, p.ModelID, err)
	}
	resultZip, err := tc.FetchResultByID(ctx, jobID)
	if err != nil {
		return fmt.Errorf("fetch MEME result for model %d: %w", p.ModelID, err)
	}

	// 5. Store the zip under the storage/data convention.
	filename := fmt.Sprintf("sim_%d.zip", model.ID)
	path, err := store.SaveZIP(ctx, model.ID, filename, resultZip)
	if err != nil {
		return fmt.Errorf("store MEME result zip for model %d: %w", p.ModelID, err)
	}

	if err := runs.UpdateStatus(p.ModelID, "completed", ""); err != nil {
		log.Errorf("model %d: failed to record MEME completed: %v", p.ModelID, err)
	}
	if submittedNow {
		log.Infof("model %d: MEME dispatch complete, result saved to %s (%d bytes)", model.ID, path, len(resultZip))
	}
	return nil
}
