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
	job, err = applyEnergyPrices(job, input)
	if err != nil {
		return TranslatedJob{}, err
	}
	return TranslatedJob{Job: job}, nil
}

// DefaultElectricityPriceEurMWh mirrors the tariff the T1K mapping hardcodes
// (config/enerplanet-to-meme.json `import.price: 300`, EUR/MWh). A model with
// no configured price keeps this value so unchanged models dispatch identically.
const DefaultElectricityPriceEurMWh = 300

// applyEnergyPrices writes the configuration's electricity import price into
// every grid trade import.price in the translated job. It is a post-translate
// pass (the T1K mapping is an embedded published module, so we cannot edit the
// `import.price: 300` literal from EnerPlanET); this mirrors how withoutUnmetDemand
// patches the job after translate. The price rides in the payload's pypsa block
// as EUR/MWh (set by payload.buildPylovoPayload from config.energy_prices).
// Absent value => default 300 EUR/MWh. Natural gas/oil costs are not applied
// here: the mapping carries no heat/gas vector today.
func applyEnergyPrices(job, input []byte) ([]byte, error) {
	price := float64(DefaultElectricityPriceEurMWh)

	var calc map[string]json.RawMessage
	if err := json.Unmarshal(input, &calc); err == nil {
		if rawPypsa, ok := calc["pypsa"]; ok {
			var pypsa map[string]json.RawMessage
			if err := json.Unmarshal(rawPypsa, &pypsa); err == nil {
				if raw, ok := pypsa["electricity_price_eur_mwh"]; ok {
					var v float64
					if err := json.Unmarshal(raw, &v); err == nil && v > 0 {
						price = v
					}
				}
			}
		}
	}

	var top map[string]json.RawMessage
	if err := json.Unmarshal(job, &top); err != nil {
		return nil, fmt.Errorf("meme: decode T1K job for energy price: %w", err)
	}
	rawModel, ok := top["model"]
	if !ok {
		return job, nil
	}
	var model map[string]json.RawMessage
	if err := json.Unmarshal(rawModel, &model); err != nil {
		return nil, err
	}
	rawTrade, ok := model["trade"]
	if !ok {
		return job, nil
	}
	var trade map[string]json.RawMessage
	if err := json.Unmarshal(rawTrade, &trade); err != nil {
		return nil, err
	}

	changed := false
	for name, raw := range trade {
		var node map[string]json.RawMessage
		if err := json.Unmarshal(raw, &node); err != nil {
			continue // not a node we can patch; leave as-is
		}
		_, isTrade := node["import"]
		if !isTrade {
			continue
		}
		var imp map[string]json.RawMessage
		if err := json.Unmarshal(node["import"], &imp); err != nil {
			continue
		}
		encoded, err := json.Marshal(price)
		if err != nil {
			return nil, err
		}
		imp["price"] = encoded
		impRaw, err := json.Marshal(imp)
		if err != nil {
			return nil, err
		}
		node["import"] = impRaw
		nodeRaw, err := json.Marshal(node)
		if err != nil {
			return nil, err
		}
		trade[name] = nodeRaw
		changed = true
	}

	if !changed {
		return job, nil
	}
	tradeRaw, err := json.Marshal(trade)
	if err != nil {
		return nil, err
	}
	model["trade"] = tradeRaw
	modelRaw, err := json.Marshal(model)
	if err != nil {
		return nil, err
	}
	top["model"] = modelRaw
	return json.Marshal(top)
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
