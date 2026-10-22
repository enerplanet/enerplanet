package jobs

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	commonModels "platform.local/common/pkg/models"
)

// orphanGrace is how long a model may sit in a run status with no task before
// it counts as orphaned: a run's status is set just before its task is
// enqueued, so a run that has only just started is never caught in between.
const orphanGrace = 5 * time.Minute

// orphanReason is the failure a model left without a task is given.
const orphanReason = "the run was interrupted because the backend stopped while it ran; run the model again"

// liveModelTasks reports the model ids named by every task that can still
// run; AsynqLiveTasks implements it.
type liveModelTasks interface {
	LiveModelIDs() (map[uint]bool, error)
}

// FailOrphanedRuns marks as failed every model left in queue, running or
// processing whose task no longer exists, so it can be run again: a MEME or
// BuEM task is not retried, and one that dies with the backend leaves its
// model in that status for good. A model of the legacy webservice path
// (webservice_id set) waits for a callback with no task and is left alone.
func FailOrphanedRuns(db *gorm.DB, live liveModelTasks, now time.Time) ([]uint, error) {
	var candidates []uint
	err := db.Model(&commonModels.Model{}).
		Where("status IN ?", []string{
			commonModels.ModelStatusQueue,
			commonModels.ModelStatusRunning,
			commonModels.ModelStatusProcessing,
		}).
		Where("webservice_id IS NULL").
		Where("updated_at < ?", now.Add(-orphanGrace)).
		Pluck("id", &candidates).Error
	if err != nil {
		return nil, fmt.Errorf("list models in a run status: %w", err)
	}
	if len(candidates) == 0 {
		return nil, nil
	}
	alive, err := live.LiveModelIDs()
	if err != nil {
		return nil, err
	}
	var failed []uint
	for _, id := range candidates {
		if alive[id] {
			continue
		}
		markModelFailed(db, id, errors.New(orphanReason))
		failed = append(failed, id)
	}
	return failed, nil
}

// AsynqLiveTasks reads the live tasks of Queues through an asynq inspector.
type AsynqLiveTasks struct {
	Inspector *asynq.Inspector
	Queues    []string
}

const liveTaskPageSize = 100

// LiveModelIDs returns the model_id of every pending, active, scheduled or
// retrying task in the queues.
func (a AsynqLiveTasks) LiveModelIDs() (map[uint]bool, error) {
	lists := []func(string, ...asynq.ListOption) ([]*asynq.TaskInfo, error){
		a.Inspector.ListPendingTasks,
		a.Inspector.ListActiveTasks,
		a.Inspector.ListScheduledTasks,
		a.Inspector.ListRetryTasks,
	}
	ids := map[uint]bool{}
	for _, queue := range a.Queues {
		for _, list := range lists {
			if err := collectModelIDs(list, queue, ids); err != nil {
				return nil, err
			}
		}
	}
	return ids, nil
}

// collectModelIDs adds the model_id of every task list returns for queue.
func collectModelIDs(list func(string, ...asynq.ListOption) ([]*asynq.TaskInfo, error), queue string, ids map[uint]bool) error {
	for page := 1; ; page++ {
		tasks, err := list(queue, asynq.PageSize(liveTaskPageSize), asynq.Page(page))
		if errors.Is(err, asynq.ErrQueueNotFound) {
			return nil
		}
		if err != nil {
			return fmt.Errorf("list tasks of queue %s: %w", queue, err)
		}
		for _, t := range tasks {
			var p struct {
				ModelID uint `json:"model_id"`
			}
			if json.Unmarshal(t.Payload, &p) == nil && p.ModelID > 0 {
				ids[p.ModelID] = true
			}
		}
		if len(tasks) < liveTaskPageSize {
			return nil
		}
	}
}
