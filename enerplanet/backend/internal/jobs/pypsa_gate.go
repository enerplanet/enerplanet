package jobs

import (
	"fmt"

	"gorm.io/gorm"

	commonModels "platform.local/common/pkg/models"

	"spatialhub_backend/internal/models"
)

// memeLegRunStore is the leg-aware persistence surface for a model's MEME run
// records (one row per (model, leg)). It is satisfied by *memerun.Store and
// faked in tests. The Calliope dispatch's memeRunStore (Save/UpdateStatus/Get,
// see dispatch_meme.go) is the calliope-only projection of the same table; the
// PyPSA leg needs this leg-keyed form so it can never read or resume the
// Calliope leg's TentaCron job.
type memeLegRunStore interface {
	SaveLeg(modelID uint, leg, runID, status string) error
	UpdateStatusLeg(modelID uint, leg, status, errMsg string) error
	GetLeg(modelID uint, leg string) (*models.ModelMemeRun, error)
	// MarkLegFailed ensures the leg's run record exists and is terminal
	// 'failed' with the error, preserving an already-recorded run id. It is the
	// writer for a failure that happens BEFORE a submit (so no row was ever
	// written) — without it such a failure left no leg status at all and the
	// dashboard showed a grey, not red, action.
	MarkLegFailed(modelID uint, leg, errMsg string) error
}

// CalliopeLegReady is the GATE for the derived, isolated PyPSA leg: it refuses
// unless the model's Calliope leg reached the terminal 'completed' state (the
// dispatch happened AND the result was ingested), so the PyPSA pass always
// reads real Calliope flow series. PyPSA is a passthrough of the Calliope
// results, so a power flow never runs before or alongside a successful
// Calliope solve.
//
// It returns nil when the leg may run, else an error describing the gate
// failure. Both consumers use it: the run-meme-pypsa endpoint (fail fast at
// request time, 400 on the refusal) and the dispatch handler (the authority
// the worker runs).
func CalliopeLegReady(runs memeLegRunStore, modelID uint) error {
	rec, err := runs.GetLeg(modelID, models.MemeLegCalliope)
	if err != nil {
		return fmt.Errorf("pypsa leg model %d: could not read calliope run record: %w", modelID, err)
	}
	if rec == nil {
		return fmt.Errorf("pypsa leg model %d: cannot run a power flow without a calliope run; run the calliope leg first", modelID)
	}
	if rec.Status != models.MemeRunStatusCompleted {
		return fmt.Errorf("pypsa leg model %d: calliope leg must be completed before pypsa (current status %q); run the calliope leg first", modelID, rec.Status)
	}
	return nil
}

// pypsaFailureStatus is the model status a failed PyPSA leg leaves behind:
// 'completed' when the Calliope leg it derives from is still completed (the
// Calliope results are valid, so the leg stays retryable without re-running
// Calliope), else 'failed' (the gate should have prevented the run, so a
// genuinely broken model is never shown as completed).
func pypsaFailureStatus(runs memeLegRunStore, modelID uint) string {
	rec, err := runs.GetLeg(modelID, models.MemeLegCalliope)
	if err != nil || rec == nil || rec.Status != models.MemeRunStatusCompleted {
		return commonModels.ModelStatusFailed
	}
	return commonModels.ModelStatusCompleted
}

// failPypsaLeg records a failed PyPSA leg WITHOUT forcing a Calliope re-run:
// the power flow is a derived add-on over a completed Calliope leg, so its
// failure must leave the model 'completed' — the Calliope results are still
// valid and only the PyPSA leg record carries the failure, so the PyPSA leg
// stays retryable from the dashboard. The caller marks the leg failed and
// returns the error to surface it.
func failPypsaLeg(db *gorm.DB, runs memeLegRunStore, modelID uint, failure error) {
	if pypsaFailureStatus(runs, modelID) == commonModels.ModelStatusCompleted {
		markModelCompleted(db, modelID)
		return
	}
	markModelFailed(db, modelID, failure)
}
