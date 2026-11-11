package demand

import "sync"

// The counts live in this process, so the poll endpoint sees them only while
// the API and the Asynq worker share a process. Move to Redis if they are
// deployed separately.
var progress = struct {
	sync.Mutex
	ways map[uint]map[string]struct{}
}{ways: map[uint]map[string]struct{}{}}

// StartProgress begins counting modelID's buildings whose BuEM result is stored.
func StartProgress(modelID uint) {
	progress.Lock()
	defer progress.Unlock()
	progress.ways[modelID] = map[string]struct{}{}
}

// MarkComputed counts way as computed for modelID's running analysis.
func MarkComputed(modelID uint, way string) {
	progress.Lock()
	defer progress.Unlock()
	if ways, ok := progress.ways[modelID]; ok {
		ways[way] = struct{}{}
	}
}

// EndProgress stops counting for modelID; its results are then on its rows.
func EndProgress(modelID uint) {
	progress.Lock()
	defer progress.Unlock()
	delete(progress.ways, modelID)
}

// Computed returns how many of modelID's buildings have a stored BuEM result
// not yet linked to the model.
func Computed(modelID uint) int64 {
	progress.Lock()
	defer progress.Unlock()
	return int64(len(progress.ways[modelID]))
}
