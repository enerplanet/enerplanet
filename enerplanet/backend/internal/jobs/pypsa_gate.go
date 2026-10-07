package jobs

import (
	"fmt"

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
}

// CalliopeLegReady is the GATE for the derived, isolated PyPSA leg: it refuses
// unless the model's Calliope leg reached the terminal 'completed' state (the
// dispatch happened AND the result was ingested), so the PyPSA pass always
// reads real Calliope flow series. PyPSA is a passthrough of the Calliope
// results — a power flow can never run before or alongside a successful
// Calliope solve (the plan's Appendix A: "PyPSA runs separately — never at the
// same time as Calliope").
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
