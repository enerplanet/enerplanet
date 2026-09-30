package resultservice

import (
	"context"
	"encoding/json"
	"math"
	"sort"
	"time"

	"github.com/sirupsen/logrus"
)

// The wire mapping turns a Coati document's transmission data into the rows the
// Grid panel reads. It is the ONLY wire source for a MEME result: MEME's PyPSA
// target emits transmission as a transport Link, so the bundle has no lines.csv,
// no impedance and no electrical loading.
//
// Coati normalises PyPSA and Calliope to the same transmission_flow +
// capacities + tech_metadata contract, so this one mapping serves either leg.
// The percent written is flow/capacity UTILISATION, not loading_percent — see
// internal/result/capabilities and tasks/meme-pypsa-result-parity.md.

// mapWireLoading builds one row per wire per timestep.
func mapWireLoading(doc *CoatiResultsDocument) []PyPSALineLoadingRecord {
	if doc == nil || len(doc.TransmissionFlow) == 0 {
		return nil
	}

	ratings := wireRatings(doc)
	names := wireNamesByEndpoints(doc)
	timestamps := make([]time.Time, len(doc.Timestamps))
	for i, raw := range doc.Timestamps {
		if ts, ok := parseTimestamp(raw); ok {
			timestamps[i] = ts
		}
	}

	// Deterministic output: Go map iteration is random.
	keys := make([]string, 0, len(doc.TransmissionFlow))
	for key := range doc.TransmissionFlow {
		keys = append(keys, key)
	}
	sort.Strings(keys)

	var out []PyPSALineLoadingRecord
	for _, key := range keys {
		flow := doc.TransmissionFlow[key]
		name := names[sortedPair(flow.From, flow.To)]
		if name == "" {
			// Ambiguous derivation (two wires over the same node pair) or a
			// document without capacities — the node pair is still a truthful
			// identifier for the arc.
			name = key
		}
		rating := ratings[name]

		n := len(flow.Timeseries)
		if len(timestamps) < n {
			n = len(timestamps)
		}
		for i := 0; i < n; i++ {
			record := PyPSALineLoadingRecord{
				Line:     name,
				Bus0:     flow.From,
				Bus1:     flow.To,
				Timestep: timestamps[i],
				// Coati reports the net arrival at To (origin flow scaled by the
				// arc efficiency); the document carries no origin-side series.
				P0: flow.Timeseries[i],
			}
			if rating > 0 {
				percent := math.Abs(flow.Timeseries[i]) / rating * 100
				record.Percent = &percent
			}
			out = append(out, record)
		}
	}
	return out
}

// wireRatings derives each wire's rating (MW) from the transmission
// technologies' capacities. Coati keys capacities "loc::tech" and attributes a
// transmission capacity to both endpoint locations, so the maximum seen wins.
func wireRatings(doc *CoatiResultsDocument) map[string]float64 {
	if doc == nil {
		return nil
	}
	ratings := map[string]float64{}
	for key, value := range doc.Capacities {
		_, tech := splitLocTech(key)
		if tech == "" || !doc.IsTransmission(tech) {
			continue
		}
		if current, ok := ratings[tech]; !ok || value > current {
			ratings[tech] = value
		}
	}
	return ratings
}

// wireNamesByEndpoints maps a node pair ("n1::n2") to the transmission
// technology connecting those two locations, so a row carries the wire's own
// name rather than a node pair.
//
// A transmission_flow entry carries no technology id, so the pairing is derived
// from the "loc::tech" capacity keys: a transmission tech appears once per
// endpoint location. Where two wires cover the same pair the derivation is
// ambiguous and the pair is dropped, leaving the caller to fall back to the key.
func wireNamesByEndpoints(doc *CoatiResultsDocument) map[string]string {
	if doc == nil {
		return nil
	}
	locsByTech := map[string]map[string]bool{}
	for key := range doc.Capacities {
		loc, tech := splitLocTech(key)
		if loc == "" || tech == "" || !doc.IsTransmission(tech) {
			continue
		}
		if locsByTech[tech] == nil {
			locsByTech[tech] = map[string]bool{}
		}
		locsByTech[tech][loc] = true
	}

	names := map[string]string{}
	seen := map[string]int{}
	for tech, locs := range locsByTech {
		if len(locs) != 2 {
			continue
		}
		pair := make([]string, 0, 2)
		for loc := range locs {
			pair = append(pair, loc)
		}
		sort.Strings(pair)
		key := pair[0] + "::" + pair[1]
		names[key] = tech
		seen[key]++
	}
	for key, count := range seen {
		if count > 1 {
			delete(names, key)
		}
	}
	return names
}

// sortedPair is the "a::b" key Coati uses for an unordered node pair.
func sortedPair(a, b string) string {
	if b < a {
		a, b = b, a
	}
	return a + "::" + b
}

// wireDocument picks the document the wire mapping reads: the PyPSA leg's
// (preferred — it is the electricity transport model), falling back to the
// Calliope document already parsed when the bundle carries no PyPSA output or
// Coati cannot convert it. The fallback is always logged, never silent.
func wireDocument(ctx context.Context, calliopeDoc *CoatiResultsDocument, extractDir string, runner CoatiRunner, log *logrus.Entry, modelID uint) *CoatiResultsDocument {
	networkNC, err := locatePyPSANetworkNC(extractDir)
	if err != nil {
		log.Warnf("No PyPSA network.nc in bundle; using the Calliope leg for wire loading model_id=%d: %v", modelID, err)
		return calliopeDoc
	}
	raw, err := runner.Convert(ctx, networkNC, CoatiFrameworkPyPSA124)
	if err != nil {
		log.Warnf("Coati convert (pypsa) failed; using the Calliope leg for wire loading model_id=%d file=%s err=%v", modelID, networkNC, err)
		return calliopeDoc
	}
	var doc CoatiResultsDocument
	if err := json.Unmarshal(raw, &doc); err != nil {
		log.Warnf("Decode PyPSA Coati document failed; using the Calliope leg for wire loading model_id=%d err=%v", modelID, err)
		return calliopeDoc
	}
	return &doc
}
