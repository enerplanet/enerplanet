package jobs

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	commonModels "platform.local/common/pkg/models"

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
func (f *fakeGateRuns) MarkLegFailed(modelID uint, leg, errMsg string) error {
	e := errMsg
	f.rec = &models.ModelMemeRun{ModelID: modelID, Leg: leg, Status: models.MemeRunStatusFailed, Error: &e}
	return nil
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

// TestPypsaFailureStatus_keepsCompletedWhenCalliopeCompleted pins the
// "no Calliope re-run on a PyPSA failure" contract: a failed PyPSA leg leaves
// the model 'completed' as long as the Calliope leg it derives from is still
// completed, so the leg stays retryable from the dashboard.
func TestPypsaFailureStatus_keepsCompletedWhenCalliopeCompleted(t *testing.T) {
	runs := &fakeGateRuns{rec: &models.ModelMemeRun{
		ModelID: 42, Leg: models.MemeLegCalliope, RunID: "job-1", Status: models.MemeRunStatusCompleted,
	}}
	assert.Equal(t, commonModels.ModelStatusCompleted, pypsaFailureStatus(runs, 42))
}

// TestPypsaFailureStatus_failsWhenCalliopeNotCompleted guards the fallback: a
// model whose Calliope leg is not completed must not be shown as completed.
func TestPypsaFailureStatus_failsWhenCalliopeNotCompleted(t *testing.T) {
	for name, runs := range map[string]*fakeGateRuns{
		"no calliope run": {},
		"calliope failed": {rec: &models.ModelMemeRun{
			ModelID: 42, Leg: models.MemeLegCalliope, RunID: "job-1", Status: models.MemeRunStatusFailed,
		}},
	} {
		t.Run(name, func(t *testing.T) {
			assert.Equal(t, commonModels.ModelStatusFailed, pypsaFailureStatus(runs, 42))
		})
	}
}
