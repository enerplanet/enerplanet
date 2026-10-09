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
//
// loading_percent is a REAL utilisation. The only rating Coati reports
// is the LP-optimised flow_cap (the wire sized to its own peak flow), so
// |flow|/capacity is identically 100. The real rating is resolved on the ingest
// side from the model config's cable types (per grid, conservative — see
// cable_ratings.go) and passed in. A wire with no resolvable rating carries NO
// loading_percent (NULL), never the fabricated artefact.

// mapWireLoading builds one row per wire per timestep. cableRatings is the
// per-grid apparent-power rating (MVA) resolved from the model config, keyed by
// grid_result_id; a nil/empty map writes no percentages.
func mapWireLoading(doc *CoatiResultsDocument, cableRatings map[string]float64) []PyPSALineLoadingRecord {
	if doc == nil || len(doc.TransmissionFlow) == 0 {
		return nil
	}

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
		rating, hasRating := resolveWireRating(name, cableRatings)

		n := len(flow.Timeseries)
		if len(timestamps) < n {
			n = len(timestamps)
		}
		for i := 0; i < n; i++ {
			// Coati reports the net flow of the exchange between the two
			// endpoints (positive = from Bus0 to Bus1). P0 is that flow at the
			// Bus0 side; the document folds both directions into ONE signed
			// series per unordered node pair (net_flows), so there is no
			// distinct other-endpoint series to read: P1 stays NULL rather than
			// being invented. Power is MW in the document, kW in the R2
			// contract -> scale at write time.
			record := PyPSALineLoadingRecord{
				Line:     name,
				Bus0:     flow.From,
				Bus1:     flow.To,
				Timestep: timestamps[i],
				P0:       mwToKw(flow.Timeseries[i]),
			}
			if hasRating {
				// Real utilisation against the weakest cable in the grid; it may
				// exceed 100, which is the flag. The rating is apparent power
				// (MVA), so the percentage is computed from the RAW MW flow, not
				// the kW value stored in P0.
				percent := math.Abs(flow.Timeseries[i]) / rating * 100
				record.Percent = &percent
			}
			out = append(out, record)
		}
	}
	return out
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

// wireDocQualifies reports whether a Coati document carries usable wire data:
// at least one PARSEABLE timestamp (so rows get a real timestep, not
// 0001-01-01) AND a transmission_flow series longer than one step (so
// utilisation is a real per-timestep series rather than a single snapshot).
// A MEME PyPSA target writes one "now" snapshot and fails both tests; the
// Calliope leg carries the real 73-step series.
func wireDocQualifies(doc *CoatiResultsDocument) bool {
	if doc == nil {
		return false
	}
	parseable := false
	for _, raw := range doc.Timestamps {
		if _, ok := parseTimestamp(raw); ok {
			parseable = true
			break
		}
	}
	if !parseable {
		return false
	}
	for _, flow := range doc.TransmissionFlow {
		if len(flow.Timeseries) > 1 {
			return true
		}
	}
	return false
}

// selectWireDocument picks the wire leg by DATA QUALITY, not by framework.
// Preference order: the PyPSA leg when it qualifies (it is the electricity
// transport model), then the Calliope leg; when neither qualifies it keeps the
// historical Calliope fallback. leg is "pypsa" | "calliope" and reason explains
// the choice so the caller can log it (never silent).
func selectWireDocument(pypsaDoc, calliopeDoc *CoatiResultsDocument) (doc *CoatiResultsDocument, leg, reason string) {
	switch {
	case wireDocQualifies(pypsaDoc):
		return pypsaDoc, "pypsa", "parseable timestamps and a multi-step transmission flow"
	case wireDocQualifies(calliopeDoc):
		return calliopeDoc, "calliope", "PyPSA leg absent or degenerate; Calliope leg carries a parseable multi-step flow"
	default:
		return calliopeDoc, "calliope", "neither leg has parseable timestamps / a multi-step flow; Calliope fallback"
	}
}

// loadPyPSAWireDoc converts the bundle's PyPSA network.nc into a Coati document,
// returning nil (with the reason logged) when the bundle carries no PyPSA
// output or Coati cannot convert it.
func loadPyPSAWireDoc(ctx context.Context, extractDir string, runner CoatiRunner, log *logrus.Entry, modelID uint) *CoatiResultsDocument {
	networkNC, err := locatePyPSANetworkNC(extractDir)
	if err != nil {
		log.Warnf("No PyPSA network.nc in bundle; using the Calliope leg for wire loading model_id=%d: %v", modelID, err)
		return nil
	}
	raw, err := runner.Convert(ctx, networkNC, CoatiFrameworkPyPSA124)
	if err != nil {
		log.Warnf("Coati convert (pypsa) failed; using the Calliope leg for wire loading model_id=%d file=%s err=%v", modelID, networkNC, err)
		return nil
	}
	var doc CoatiResultsDocument
	if err := json.Unmarshal(raw, &doc); err != nil {
		log.Warnf("Decode PyPSA Coati document failed; using the Calliope leg for wire loading model_id=%d err=%v", modelID, err)
		return nil
	}
	return &doc
}

// wireDocument picks the document the wire mapping reads. It no longer prefers
// PyPSA unconditionally: the leg is chosen by data quality (selectWireDocument)
// and the choice is always logged.
func wireDocument(ctx context.Context, calliopeDoc *CoatiResultsDocument, extractDir string, runner CoatiRunner, log *logrus.Entry, modelID uint) *CoatiResultsDocument {
	pypsaDoc := loadPyPSAWireDoc(ctx, extractDir, runner, log, modelID)

	doc, leg, reason := selectWireDocument(pypsaDoc, calliopeDoc)
	if leg == "pypsa" {
		log.Infof("Wire leg: PyPSA selected model_id=%d (%s)", modelID, reason)
	} else {
		log.Warnf("Wire leg: Calliope selected model_id=%d (%s)", modelID, reason)
	}
	return doc
}
