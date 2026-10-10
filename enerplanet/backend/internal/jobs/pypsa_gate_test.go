package jobs

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"spatialhub_backend/internal/models"
)

// fakeGateRuns is an in-memory memeLegRunStore seeded with a Calliope-leg run
// so the gate can be asserted without sqlmock.
type fakeGateRuns struct {
	rec *models.ModelMemeRun
}

func (f *fakeGateRuns) SaveLeg(modelID uint, leg, runID, status string) error {
	return nil
}
func (f *fakeGateRuns) UpdateStatusLeg(modelID uint, leg, status, errMsg string) error {
	return nil
}
func (f *fakeGateRuns) GetLeg(modelID uint, leg string) (*models.ModelMemeRun, error) {
	if f.rec != nil && leg == f.rec.Leg {
		return f.rec, nil
	}
	return nil, nil
}

func TestCalliopeLegReady_completedCalliopeAllowsPyPSA(t *testing.T) {
	runs := &fakeGateRuns{rec: &models.ModelMemeRun{
		ModelID: 42, Leg: models.MemeLegCalliope, RunID: "job-1", Status: models.MemeRunStatusCompleted,
	}}
	err := CalliopeLegReady(runs, 42)
	require.NoError(t, err)
}

func TestCalliopeLegReady_noCalliopeRunRefuses(t *testing.T) {
	runs := &fakeGateRuns{} // no run recorded
	err := CalliopeLegReady(runs, 42)
	require.Error(t, err)
	require.Contains(t, err.Error(), "calliope")
}

func TestCalliopeLegReady_runningCalliopeRefuses(t *testing.T) {
	runs := &fakeGateRuns{rec: &models.ModelMemeRun{
		ModelID: 42, Leg: models.MemeLegCalliope, RunID: "job-1", Status: models.MemeRunStatusRunning,
	}}
	err := CalliopeLegReady(runs, 42)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "completed")
}
