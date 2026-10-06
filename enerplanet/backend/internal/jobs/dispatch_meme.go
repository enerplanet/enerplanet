package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
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

// TentaCron target names for a MEME run. The framework set is fixed per target
// (a TentaCron request selects a target by name, never a URL), so running fewer
// frameworks needs its own target: `meme` is pypsa,calliope, `meme-pypsa` is
// pypsa only. MEME fails a multi-target request as a whole if one framework
// rejects it, so the split also lets a model solve when only one leg works.
const (
	memeTargetDefault   = "meme"
	memeTargetPyPSAOnly = "meme-pypsa"
)

// MemeTargetFor maps a requested framework set to the TentaCron target that
// serves it. Anything other than a lone "pypsa" keeps the full set.
func MemeTargetFor(frameworks string) string {
	if strings.TrimSpace(frameworks) == "pypsa" {
		return memeTargetPyPSAOnly
	}
	return memeTargetDefault
}

// memePollBudget is how long a MEME dispatch may stay alive waiting for the
// job. It matches TentaCron's own meme target poll timeout (30m), NOT the
// backend's generic 60s opTimeout: a MEME solve takes minutes, and a too-short
// deadline would error, trigger a asynq retry, and enqueue a duplicate.
const memePollBudget = 30 * time.Minute

// memeIdempotencyKey is the Idempotency-Key sent with a fresh MEME submit so a
// resubmit (e.g. a retry racing the persist) returns the stored TentaCron job
// instead of enqueuing a duplicate. TentaCron keys on key+payload, and the
// payload is unchanged across re-solves of the same model, so the key MUST vary
// per solve for a user re-solve to produce a NEW TentaCron job. The discriminator
// is run-scoped: model.CalculationStartedAt is set fresh by StartCalculation on
// every start (infrastructure/common/pkg/models/model.go), so the key carries
// startedAt.UnixMilli() when set, else falls back to the bare per-model key (the
// first-solve / no-run-recorded case).
func memeIdempotencyKey(modelID uint, startedAt *time.Time) string {
	if startedAt != nil {
		return fmt.Sprintf("model_%d_%d", modelID, startedAt.UnixMilli())
	}
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
	// Target is the TentaCron target (i.e. the framework set) to dispatch to:
	// memeTargetDefault (pypsa,calliope) or memeTargetPyPSAOnly. Empty means the
	// default, so an older payload keeps its meaning.
	Target string `json:"target,omitempty"`
}

// HandleDispatchMeme is the backend's native MEME calculation path: it builds
// the model's calculation payload, translates it to a MEME job via the T1K
// seam (electricity-only for now; heat is tracked in tasks/open/heat-patch.md),
// submits it over TentaCron's "meme" target, and persists the result zip.
//
// TentaCron is itself the durable single-instance SQLite queue (ADR-0002) and
// polls MEME to completion (response.mode: poll, ADR-0004); the produced job
// bytes are set via meme.TranslatePayload (the T1K seam) and never unmarshaled
// into internal/meme/job.go's lossy typed Job struct. This handler therefore:
//   - submits freshly (only when no run is recorded, or the recorded run is in a
//     terminal completed|failed state) with a RUN-SCOPED Idempotency-Key, so a
//     user-initiated re-solve (StartCalculation) creates a NEW TentaCron job
//     instead of reusing an old one; an in-flight (running) run is resumed by id
//     so a dispatch retry never duplicates a MEME enqueue;
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
	enq IngestMemeEnqueuer,
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

	// Any dispatch failure must leave the model in a terminal 'failed' state, or
	// it sits in 'queue' forever (the ingest handler is the only other writer,
	// and it never runs when dispatch fails early).
	defer func() {
		if retErr != nil {
			markModelFailed(db, p.ModelID, retErr.Error())
		}
	}()

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

	// 3. Resolve the TentaCron job id. No run recorded OR a TERMINAL run ->
	//    fresh submit with a run-scoped Idempotency-Key (guarantees a NEW job);
	//    a still-alive (running) run -> resume by id, never resubmit.
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
	target := p.Target
	if target == "" {
		target = memeTargetDefault
	}
	switch {
	case rec == nil || models.MemeRunFinished(rec.Status):
		// Fresh submit. Either no run is recorded (first solve) or the recorded
		// run already reached a TERMINAL state (completed|failed). A terminal
		// run can only be reached here via a USER-INITIATED re-solve (the
		// StartCalculation path re-dispatches through this job); it must
		// FRESH-submit a new MEME solve, never resume the old one. The
		// run-scoped idempotency key (baked from model.CalculationStartedAt,
		// which StartCalculation sets fresh on every start) guarantees
		// TentaCron creates a NEW request/job for this solve.
		jobID, err = tc.SubmitMeme(ctx, target, memeJob, memeIdempotencyKey(model.ID, model.CalculationStartedAt))
		if err != nil {
			return fmt.Errorf("meme dispatch via TentaCron for model %d: %w", p.ModelID, err)
		}
		if err := runs.Save(p.ModelID, jobID, "running"); err != nil {
			log.Errorf("model %d: failed to persist MEME TentaCron job %s: %v", p.ModelID, jobID, err)
		}
		submittedNow = true
		markModelRunning(db, p.ModelID)
		log.Infof("model %d: submitted MEME job to TentaCron id=%s", p.ModelID, jobID)
	default:
		// A run is recorded and still alive (non-terminal, i.e. running):
		// resume it by id, never resubmit (a dispatch retry after a transient
		// post-submit hiccup). No new MEME job is enqueued.
		jobID = rec.RunID
		log.Infof("model %d: resuming existing MEME TentaCron job id=%s (no resubmit)", p.ModelID, jobID)
	}

	// 4. Long-poll by id on the meme budget, then read the raw zip via /result.
	//    A MEME solve failure must take the run to the TERMINAL 'failed' state
	//    (Path 2), so a user re-solve is allowed; otherwise the run stays
	//    'running' forever and a dispatch retry resume-by-id re-fetches the same
	//    failed TentaCron job.
	if err := tc.AwaitResultByID(ctx, jobID, memePollBudget); err != nil {
		_ = runs.UpdateStatus(p.ModelID, models.MemeRunStatusFailed, err.Error())
		return fmt.Errorf("meme job %s via TentaCron for model %d: %w", jobID, p.ModelID, err)
	}
	resultZip, err := tc.FetchResultByID(ctx, jobID)
	if err != nil {
		_ = runs.UpdateStatus(p.ModelID, models.MemeRunStatusFailed, err.Error())
		return fmt.Errorf("fetch MEME result for model %d: %w", p.ModelID, err)
	}

	// 5. Store the zip under the storage/data convention.
	filename := fmt.Sprintf("sim_%d.zip", model.ID)
	path, err := store.SaveZIP(ctx, model.ID, filename, resultZip)
	if err != nil {
		_ = runs.UpdateStatus(p.ModelID, models.MemeRunStatusFailed, err.Error())
		return fmt.Errorf("store MEME result zip for model %d: %w", p.ModelID, err)
	}

	// 6. Enqueue the ingest (Step 6): parse the stored zip via Coati into the
	//    R2 tables. Dispatch's job ends here: the terminal 'completed'/'failed'
	//    transition is owned by the ingest handler (completed on parse success,
	//    failed with the parse error on failure), so dispatch must NOT pre-mark
	//    'completed' before the parse has run.
	if err := enq.EnqueueIngestMeme(ctx, IngestMemeResultPayload{ModelID: p.ModelID, UserID: p.UserID, ZipPath: path}); err != nil {
		_ = runs.UpdateStatus(p.ModelID, models.MemeRunStatusFailed, err.Error())
		return fmt.Errorf("enqueue ingest_meme_result for model %d: %w", p.ModelID, err)
	}
	log.Infof("model %d: enqueued MEME result ingest for stored zip %s, terminal status owned by the ingest", model.ID, path)

	if submittedNow {
		log.Infof("model %d: MEME dispatch complete, result saved to %s (%d bytes)", model.ID, path, len(resultZip))
	}
	return nil
}
