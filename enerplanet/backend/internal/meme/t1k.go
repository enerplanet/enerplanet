package meme

import (
	"encoding/json"
	"fmt"

	"github.com/enerplanet/T1K/pkg/t1k"
)

// jobTask is T1K's default enerplanet-to-meme transform. It is stateless and
// safe to share.
var jobTask = t1k.NewTransformTask(t1k.WithConfig(t1k.DefaultConfig()))

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
// vector or heat pump.
//
// T1K's default mapping sets experiment.allow_unmet_demand, which MEME's PyPSA
// target rejects. It is removed so one job body serves both the meme-calliope
// and meme-pypsa targets.
func TranslatePayload(input []byte) (TranslatedJob, error) {
	out, err := jobTask.Transform(input)
	if err != nil {
		return TranslatedJob{}, fmt.Errorf("meme: translate payload via T1K: %w", err)
	}
	job, err := withoutUnmetDemand(out)
	if err != nil {
		return TranslatedJob{}, err
	}
	return TranslatedJob{Job: job}, nil
}

// withoutUnmetDemand deletes experiment.allow_unmet_demand from a MEME job.
// Values stay raw JSON, so numbers are never re-encoded.
func withoutUnmetDemand(job []byte) ([]byte, error) {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(job, &top); err != nil {
		return nil, fmt.Errorf("meme: decode T1K job: %w", err)
	}
	raw, ok := top["experiment"]
	if !ok {
		return job, nil
	}
	var experiment map[string]json.RawMessage
	if err := json.Unmarshal(raw, &experiment); err != nil {
		return nil, fmt.Errorf("meme: decode T1K job experiment: %w", err)
	}
	if _, ok := experiment["allow_unmet_demand"]; !ok {
		return job, nil
	}
	delete(experiment, "allow_unmet_demand")
	encoded, err := json.Marshal(experiment)
	if err != nil {
		return nil, fmt.Errorf("meme: encode job experiment: %w", err)
	}
	top["experiment"] = encoded
	out, err := json.Marshal(top)
	if err != nil {
		return nil, fmt.Errorf("meme: encode job: %w", err)
	}
	return out, nil
}
