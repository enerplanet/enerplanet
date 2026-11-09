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
// via T1K. The enerplanet-to-meme mapping carries per-step electricity, heat,
// cooling and gas demand from properties.demand_series and the buildings'
// heat, cooling and gas technologies.
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

// TransmissionIDs returns the set of the translated job's transmission arc
// ids — the connecting lines/transformers the model carries, keyed exactly as
// the job names them. The isolated PyPSA pass consumes this to tell a
// connecting line (whose flow rides both the flow_out and flow_in series) from
// a storage tech (which also rides both, for a different reason).
func TransmissionIDs(job []byte) (map[string]bool, error) {
	var top map[string]json.RawMessage
	if err := json.Unmarshal(job, &top); err != nil {
		return nil, fmt.Errorf("meme: decode T1K job: %w", err)
	}
	raw, ok := top["model"]
	if !ok {
		return map[string]bool{}, nil
	}
	var model map[string]json.RawMessage
	if err := json.Unmarshal(raw, &model); err != nil {
		return nil, fmt.Errorf("meme: decode job model: %w", err)
	}
	arcRaw, ok := model["transmission"]
	if !ok {
		return map[string]bool{}, nil
	}
	var arcs map[string]json.RawMessage
	if err := json.Unmarshal(arcRaw, &arcs); err != nil {
		return nil, fmt.Errorf("meme: decode job transmission: %w", err)
	}
	out := make(map[string]bool, len(arcs))
	for id := range arcs {
		out[id] = true
	}
	return out, nil
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
