package meme

import (
	_ "embed"
	"fmt"

	"github.com/enerplanet/T1K/pkg/t1k"
)

//go:embed mapping.json
var mappingJSON []byte

// jobTask is the T1K transform task bound to the embedded enerplanet-to-meme
// mapping, with the allow_unmet_demand rule removed so the produced job
// validates clean against BOTH pypsa and calliope (MEME's TentaCron target is
// hard-fixed to "pypsa,calliope"; PyPSA rejects allow_unmet_demand). The task
// is stateless and safe to share.
//
// mapping.json is copied from T1K's embedded config minus the offending rule;
// keep it in sync when the upstream mapping changes (see tasks/open/heat-patch.md).
var jobTask = mustLoadJobTask()

func mustLoadJobTask() *t1k.TransformTask {
	cfg, err := t1k.LoadConfig(mappingJSON)
	if err != nil {
		panic(fmt.Sprintf("meme: invalid embedded enerplanet-to-meme mapping: %v", err))
	}
	return t1k.NewTransformTask(t1k.WithConfig(cfg))
}

// Payload is the calculation payload this translator consumes: the shape
// payload.CalculationPayload builds (topology + per-node techs). It is
// passed as raw JSON so T1K's declarative mapping reads it directly.
//
// TranslatedJob is the produced MEME job's canonical JSON (NOT the lossy
// typed Job struct, which cannot carry costs.monetary/performance/storage).
type TranslatedJob struct {
	// Job is the MEME job body, ready for POST /simulate over TentaCron.
	Job []byte
}

// TranslatePayload converts a calculation payload (as JSON) into a MEME job
// via T1K. Electricity only: the enerplanet-to-meme mapping emits no heat
// vector or heat pump. Retrofitting heat is tracked in tasks/open/heat-patch.md.
func TranslatePayload(input []byte) (TranslatedJob, error) {
	out, err := jobTask.Transform(input)
	if err != nil {
		return TranslatedJob{}, fmt.Errorf("meme: translate payload via T1K: %w", err)
	}
	return TranslatedJob{Job: out}, nil
}