package resultservice

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/sirupsen/logrus"

	"spatialhub_backend/internal/models"
)

// This file is Route 2 of the MEME `meme-pypsa` power-flow migration: the
// isolated PyPSA leg reads the bundle through COATI's native power-flow reader
// instead of hand-parsing the result CSVs.
//
// MEME main always exports output/network.nc next to output/power_flow/ (the
// per-quantity tables + convergence.csv). Coati converts the network into the
// unified results document and, when the network holds a power-flow solution
// (no objective, bus results present), reports it under
// results.details["power_flow"]:
//
//	converged         per-snapshot bools (from power_flow/convergence.csv)
//	iterations        per-snapshot iteration counts, when the record says
//	slack_buses       the AC sub-networks' slack buses
//	voltage_magnitude {bus: [pu per snapshot]}   (AC buses only)
//	voltage_angle     {bus: [rad per snapshot]} (AC buses only)
//	reactive_power    {loc::tech: [MVAr per snapshot]} (generators + storage)
//	branch_loading    {branch: [s/s_nom per snapshot]} (lines + transformers)
//
// Every series is aligned with the document's timestamps (snapshot order).
// The document has NO per-bus active-power series — MEME's power_flow/buses-p.csv
// is the only per-bus p source — so the Coati branch maps:
//
//	results_pypsa_voltage      v_mag_pu = voltage_magnitude (pu, as-is)
//	                           v_ang    = voltage_angle (rad, as-is)
//	results_pypsa_power        p        = buses-p.csv (MW -> kW, x1000)
//	                           q        = buses-q.csv (MVAr -> kVAr, x1000) —
//	                                      the per-bus NET reactive, same basis
//	                                      as p; falls back to the per-location
//	                                      sum of reactive_power (generators
//	                                      only) when the table is absent
//	results_pypsa_line_loading loading_percent = branch_loading ratio x100
//	                           bus0/bus1 = the branch's endpoint AC buses
//	                           p0/p1/q0/q1 = lines-*.csv (MW -> kW) when present
//
// The legacy csv_sim_* direct-CSV streaming stays intact as the fallback for
// old bundles (no network.nc / no power_flow/ export): see IngestPyPSAResult.

// coatiPowerFlow is the typed view of results.details["power_flow"]. A
// divergent snapshot's non-finite values are written as null by Coati, which
// decodes to zero here — the convergence record flags such snapshots.
type coatiPowerFlow struct {
	Converged        []bool               `json:"converged"`
	Iterations       []int                `json:"iterations"`
	SlackBuses       []string             `json:"slack_buses"`
	VoltageMagnitude map[string][]float64 `json:"voltage_magnitude"`
	VoltageAngle     map[string][]float64 `json:"voltage_angle"`
	ReactivePower    map[string][]float64 `json:"reactive_power"`
	BranchLoading    map[string][]float64 `json:"branch_loading"`
}

// decodeCoatiPowerFlow returns the typed details["power_flow"] when the
// document carries a usable power-flow record — at least one electrical
// series or the per-snapshot convergence list. Nil means Coati did not detect
// a power flow (an optimize run, or a degenerate network); the caller then
// falls back to the legacy CSV ingest.
func decodeCoatiPowerFlow(doc *CoatiResultsDocument) *coatiPowerFlow {
	if doc == nil {
		return nil
	}
	raw, ok := doc.Details["power_flow"]
	if !ok {
		return nil
	}
	var pf coatiPowerFlow
	if err := json.Unmarshal(raw, &pf); err != nil {
		return nil
	}
	if len(pf.Converged) == 0 && len(pf.VoltageMagnitude) == 0 &&
		len(pf.VoltageAngle) == 0 && len(pf.ReactivePower) == 0 && len(pf.BranchLoading) == 0 {
		return nil
	}
	return &pf
}

// pypsaCoatiDocument runs Coati over the bundle's network.nc and returns the
// decoded document + typed power-flow details. A conversion or decode failure
// is NOT fatal: the bundle may predate the native reader, and the caller falls
// back to the legacy CSV ingest.
func (s *ResultService) pypsaCoatiDocument(ctx context.Context, networkNC string, modelID uint, log *logrus.Entry) (*CoatiResultsDocument, *coatiPowerFlow) {
	raw, err := s.coati().Convert(ctx, networkNC, CoatiFrameworkPyPSA124)
	if err != nil {
		log.Warnf("Coati convert (pypsa power flow) failed model_id=%d file=%s err=%v; using the legacy CSV ingest", modelID, networkNC, err)
		return nil, nil
	}
	var doc CoatiResultsDocument
	if err := json.Unmarshal(raw, &doc); err != nil {
		log.Warnf("Decode PyPSA Coati document failed model_id=%d err=%v; using the legacy CSV ingest", modelID, err)
		return nil, nil
	}
	pf := decodeCoatiPowerFlow(&doc)
	if pf == nil {
		log.Debugf("No details['power_flow'] in Coati document model_id=%d; using the legacy CSV ingest", modelID)
		return nil, nil
	}
	return &doc, pf
}

// coati returns the injected CoatiRunner, defaulting to the subprocess
// transport — the same resolution the Calliope/MEME leg uses.
func (s *ResultService) coati() CoatiRunner {
	if s.coatiRunner != nil {
		return s.coatiRunner
	}
	return SubprocessCoatiRunner{}
}

// coatiTimestamps parses the document's snapshot labels in order. A label
// Coati cannot parse (a position of an unlabeled network) is skipped, exactly
// as the wire mapping treats unparseable timestamps.
func coatiTimestamps(doc *CoatiResultsDocument) []time.Time {
	if doc == nil {
		return nil
	}
	out := make([]time.Time, 0, len(doc.Timestamps))
	for _, raw := range doc.Timestamps {
		if ts, ok := parseTimestamp(raw); ok {
			out = append(out, ts)
		}
	}
	return out
}

// splitCoatiBus splits a bus name "loc::carrier" into its location and
// carrier (Coati's location convention: the part before the first "::").
func splitCoatiBus(bus string) (loc, carrier string) {
	loc, carrier, _ = strings.Cut(bus, "::")
	return loc, carrier
}

// flushRows writes the mapped rows in batches of the inserter's size.
func flushRows[T any](inserter *StreamingInserter, rows []T, name string) error {
	for i := 0; i < len(rows); i += inserter.batchSize {
		end := i + inserter.batchSize
		if end > len(rows) {
			end = len(rows)
		}
		chunk := rows[i:end]
		if err := inserter.flushBatch(&chunk, name); err != nil {
			return fmt.Errorf("failed to insert %s batch: %w", name, err)
		}
	}
	return nil
}

// mapCoatiPowerFlowVoltage maps the document's per-bus voltage series into
// results_pypsa_voltage rows. v_mag_pu is pu and v_ang radians — neither is
// scaled. Only AC buses appear (Coati reports those only).
func mapCoatiPowerFlowVoltage(modelID uint, doc *CoatiResultsDocument, pf *coatiPowerFlow) []models.ResultsPyPSAVoltage {
	timestamps := coatiTimestamps(doc)
	if len(timestamps) == 0 || len(pf.VoltageMagnitude) == 0 {
		return nil
	}
	buses := make([]string, 0, len(pf.VoltageMagnitude))
	for bus := range pf.VoltageMagnitude {
		buses = append(buses, bus)
	}
	sort.Strings(buses)

	var out []models.ResultsPyPSAVoltage
	for _, bus := range buses {
		loc, _ := splitCoatiBus(bus)
		magnitude := pf.VoltageMagnitude[bus]
		angle := pf.VoltageAngle[bus]
		for i := 0; i < len(magnitude) && i < len(timestamps); i++ {
			row := models.ResultsPyPSAVoltage{
				ModelID:  modelID,
				Bus:      bus,
				Location: loc,
				Timestep: timestamps[i],
				VMagPu:   magnitude[i],
			}
			if angle != nil && i < len(angle) {
				v := angle[i]
				row.VAng = &v
			}
			out = append(out, row)
		}
	}
	return out
}

// powerFlowBusTable reads one MEME power_flow/<table>.csv (snapshots down,
// components across, first column the snapshot index label) into
// component -> per-snapshot values.
func powerFlowBusTable(path string) (map[string][]float64, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	reader := csv.NewReader(file)
	reader.FieldsPerRecord = -1 // tolerate a ragged row; pad the missing columns below
	header, err := reader.Read()
	if err != nil {
		return nil, err
	}
	names := header[1:]
	values := make(map[string][]float64, len(names))
	// Column order fixed by the header; rows appended per snapshot. EVERY column
	// is appended for EVERY row — a blank or non-finite cell (a diverged
	// snapshot) becomes a 0 placeholder rather than a skipped append, so a later
	// snapshot is never shifted by one. The convergence record flags the
	// diverged snapshot; the value itself is meaningless there.
	series := make([][]float64, len(names))
	for {
		row, err := reader.Read()
		if err != nil {
			break // io.EOF or a ragged tail row: stop, keep what parsed
		}
		for i := 0; i < len(names); i++ {
			v := 0.0
			if col := i + 1; col < len(row) {
				if parsed, perr := parseCSVFloat(row[col]); perr == nil {
					v = parsed
				}
			}
			series[i] = append(series[i], v)
		}
	}
	for i, name := range names {
		if name == "" {
			continue
		}
		values[name] = series[i]
	}
	return values, nil
}

// aggregateCoatiReactive sums the document's per-technology reactive series by
// location (key "loc::tech"). Values stay MVAr (the power table stores kVAr;
// the caller scales).
func aggregateCoatiReactive(pf *coatiPowerFlow) map[string][]float64 {
	agg := map[string][]float64{}
	for key, series := range pf.ReactivePower {
		loc, _, _ := strings.Cut(key, "::")
		if loc == "" {
			continue
		}
		known := agg[loc]
		if known == nil {
			agg[loc] = append([]float64(nil), series...)
			continue
		}
		n := len(known)
		if len(series) < n {
			n = len(series)
		}
		for i := 0; i < n; i++ {
			known[i] += series[i]
		}
	}
	return agg
}

// mapCoatiPowerFlowPower maps the bus power rows: p is the per-bus net
// injection from MEME's power_flow/buses-p.csv and q is the per-bus net
// reactive from power_flow/buses-q.csv (both MW/MVAr -> kW/kVAr) — the SAME
// per-bus NET basis, so the two columns of a row always describe the same
// quantity. Only when the bundle carries no buses-q.csv does q fall back to the
// document's per-location reactive total (MVAr -> kVAr), which sums GENERATORS
// only — a different basis, flagged in the log by the caller's absence of the
// table. Rows cover the AC buses (the same set the voltage table carries); a bus
// without an active series is skipped (p is NOT NULL), one without reactive data
// carries q NULL.
func mapCoatiPowerFlowPower(modelID uint, doc *CoatiResultsDocument, pf *coatiPowerFlow, powerFlowDir string) []models.ResultsPyPSAPower {
	timestamps := coatiTimestamps(doc)
	if len(timestamps) == 0 {
		return nil
	}
	pByBus, err := powerFlowBusTable(filepath.Join(powerFlowDir, "buses-p.csv"))
	if err != nil {
		return nil // no active-per-bus table: nothing honest to write
	}
	// Per-bus net reactive (same basis as p) when MEME wrote it.
	qByBus, _ := powerFlowBusTable(filepath.Join(powerFlowDir, "buses-q.csv"))
	reactive := aggregateCoatiReactive(pf)

	buses := make([]string, 0, len(pf.VoltageMagnitude))
	for bus := range pf.VoltageMagnitude {
		buses = append(buses, bus)
	}
	sort.Strings(buses)

	var out []models.ResultsPyPSAPower
	for _, bus := range buses {
		loc, _ := splitCoatiBus(bus)
		pSeries := pByBus[bus]
		if len(pSeries) == 0 {
			continue
		}
		qSeries := qByBus[bus]
		if qSeries == nil {
			qSeries = reactive[loc] // fallback: generator-only reactive on this location
		}
		for i := 0; i < len(pSeries) && i < len(timestamps); i++ {
			row := models.ResultsPyPSAPower{
				ModelID:  modelID,
				Bus:      bus,
				Location: loc,
				Timestep: timestamps[i],
				P:        mwToKw(pSeries[i]),
			}
			if qSeries != nil && i < len(qSeries) {
				q := mwToKw(qSeries[i])
				row.Q = &q
			}
			out = append(out, row)
		}
	}
	return out
}

// branchEndpoints resolves a branch's endpoint locations from the document's
// per-endpoint capacities of its transmission technology (the only place the
// document names a branch's ends).
func branchEndpoints(doc *CoatiResultsDocument, branch string) (string, string, bool) {
	if doc == nil {
		return "", "", false
	}
	// Coati strips a "loc::" prefix when naming a component; MEME's branch ids
	// carry none, but a foreign emitter might.
	tech := branch
	if loc, named, ok := strings.Cut(branch, "::"); ok && loc != "" && named != "" {
		tech = named
	}
	locs := map[string]bool{}
	for key := range doc.Capacities {
		loc, t := splitLocTech(key)
		if loc == "" || t != tech || !doc.IsTransmission(tech) {
			continue
		}
		locs[loc] = true
	}
	if len(locs) != 2 {
		return "", "", false
	}
	endpoints := make([]string, 0, 2)
	for loc := range locs {
		endpoints = append(endpoints, loc)
	}
	sort.Strings(endpoints)
	return endpoints[0], endpoints[1], true
}

// mapCoatiPowerFlowLineLoading maps the document's per-branch loading into
// results_pypsa_line_loading rows. loading_percent = the s/s_nom ratio x100;
// bus0/bus1 are the branch's endpoint AC buses; p0/p1/q0/q1 come from MEME's
// power_flow/lines-*.csv tables (MW/MVAr -> kW/kVAr) when present. The
// branch_loading map merges lines AND transformers — the doc does not say
// which is which — so the bundle's lines-*.csv / transformers-*.csv column
// sets classify them (transformers have no home table in the R2 contract and
// are skipped).
func mapCoatiPowerFlowLineLoading(modelID uint, doc *CoatiResultsDocument, pf *coatiPowerFlow, powerFlowDir string) []models.ResultsPyPSALineLoading {
	timestamps := coatiTimestamps(doc)
	if len(timestamps) == 0 || len(pf.BranchLoading) == 0 {
		return nil
	}

	// The AC bus of each location (voltage keys are the AC buses).
	busByLoc := map[string]string{}
	for bus := range pf.VoltageMagnitude {
		loc, _ := splitCoatiBus(bus)
		if loc != "" {
			busByLoc[loc] = bus
		}
	}

	// Lines vs transformers: the per-quantity tables are the kind record.
	lineNames, transformerNames := branchKindSets(powerFlowDir)

	flows := map[string]map[string][]float64{}
	for _, table := range []string{"lines-p0.csv", "lines-p1.csv", "lines-q0.csv", "lines-q1.csv"} {
		if values, err := powerFlowBusTable(filepath.Join(powerFlowDir, table)); err == nil {
			flows[table] = values
		}
	}

	branches := make([]string, 0, len(pf.BranchLoading))
	for branch := range pf.BranchLoading {
		branches = append(branches, branch)
	}
	sort.Strings(branches)

	var out []models.ResultsPyPSALineLoading
	for _, branch := range branches {
		if !branchIsLine(branch, lineNames, transformerNames) {
			continue
		}
		from, to, ok := branchEndpoints(doc, branch)
		if !ok {
			continue // no honest endpoints -> no row (bus0/bus1 are NOT NULL)
		}
		bus0, bus1 := busByLoc[from], busByLoc[to]
		if bus0 == "" || bus1 == "" {
			continue
		}
		loading := pf.BranchLoading[branch]
		for i := 0; i < len(loading) && i < len(timestamps); i++ {
			row := models.ResultsPyPSALineLoading{
				ModelID:  modelID,
				Line:     branch,
				Bus0:     bus0,
				Bus1:     bus1,
				Timestep: timestamps[i],
			}
			if v := scalarAt(flows["lines-p0.csv"], branch, i); v != nil {
				row.P0 = mwToKw(*v)
			}
			if v := scalarAt(flows["lines-p1.csv"], branch, i); v != nil {
				p1 := mwToKw(*v)
				row.P1 = &p1
			}
			if v := scalarAt(flows["lines-q0.csv"], branch, i); v != nil {
				q0 := mwToKw(*v)
				row.Q0 = &q0
			}
			if v := scalarAt(flows["lines-q1.csv"], branch, i); v != nil {
				q1 := mwToKw(*v)
				row.Q1 = &q1
			}
			percent := loading[i] * 100
			row.LoadingPercent = &percent
			out = append(out, row)
		}
	}
	return out
}

// scalarAt returns the value of the named component's series at snapshot i.
func scalarAt(series map[string][]float64, name string, i int) *float64 {
	if len(series) == 0 {
		return nil
	}
	values := series[name]
	if i >= len(values) {
		return nil
	}
	v := values[i]
	return &v
}

// branchKindSets reads the line and transformer names from the bundle's
// power_flow tables. A missing table means "no such components".
func branchKindSets(powerFlowDir string) (lines, transformers map[string]bool) {
	lines = map[string]bool{}
	transformers = map[string]bool{}
	if values, err := powerFlowBusTable(filepath.Join(powerFlowDir, "lines-p0.csv")); err == nil {
		for name := range values {
			lines[name] = true
		}
	}
	if values, err := powerFlowBusTable(filepath.Join(powerFlowDir, "transformers-p0.csv")); err == nil {
		for name := range values {
			transformers[name] = true
		}
	}
	return lines, transformers
}

// branchIsLine classifies a branch_loading entry. The tables are the kind
// record; without them every entry is treated as a line (the R2 contract has
// a line-loading home but none for transformers).
func branchIsLine(branch string, lineNames, transformerNames map[string]bool) bool {
	if len(lineNames) > 0 {
		return lineNames[branch]
	}
	if len(transformerNames) > 0 {
		return !transformerNames[branch]
	}
	return true
}

// countCoatiLines returns the number of LINE branches the power-flow record
// carries (the summary's wire count).
func countCoatiLines(pf *coatiPowerFlow, powerFlowDir string) int {
	if pf == nil {
		return 0
	}
	lineNames, transformerNames := branchKindSets(powerFlowDir)
	count := 0
	for branch := range pf.BranchLoading {
		if branchIsLine(branch, lineNames, transformerNames) {
			count++
		}
	}
	return count
}

// summarizePyPSACoati builds the convergence verdict from the power-flow
// record's per-snapshot flags (the source of truth), with the document's
// termination condition as the fallback when the record has no flags.
func summarizePyPSACoati(pf *coatiPowerFlow, doc *CoatiResultsDocument) *PyPSASummary {
	s := &PyPSASummary{}
	total := len(doc.Timestamps)
	if len(pf.Converged) == 0 {
		// No record next to the network: trust Coati's verdict (it only ever
		// says "converged" when every snapshot of a solved flow converged).
		if doc.TerminationCondition != nil && *doc.TerminationCondition == "converged" {
			s.Converged = true
			s.ConvergedSnapshots = total
		}
		s.TotalSnapshots = total
		return s
	}
	s.TotalSnapshots = len(pf.Converged)
	for _, converged := range pf.Converged {
		if converged {
			s.ConvergedSnapshots++
		}
	}
	s.Converged = s.ConvergedSnapshots > 0 && s.ConvergedSnapshots == s.TotalSnapshots
	return s
}

// The streamCoati* methods map the document into rows and insert them in
// batches. Each table is optional and independent: a bundle whose power flow
// did not converge still carries tables (MEME writes every snapshot), and a
// failure to stream one table must not fail the model — only gate that section.
func (s *ResultService) streamCoatiVoltage(inserter *StreamingInserter, doc *CoatiResultsDocument, pf *coatiPowerFlow) error {
	rows := mapCoatiPowerFlowVoltage(inserter.modelID, doc, pf)
	if len(rows) == 0 {
		return nil
	}
	return flushRows(inserter, rows, "pypsa_voltage")
}

func (s *ResultService) streamCoatiPower(inserter *StreamingInserter, doc *CoatiResultsDocument, pf *coatiPowerFlow, powerFlowDir string) error {
	rows := mapCoatiPowerFlowPower(inserter.modelID, doc, pf, powerFlowDir)
	if len(rows) == 0 {
		return nil
	}
	return flushRows(inserter, rows, "pypsa_power")
}

func (s *ResultService) streamCoatiLineLoading(inserter *StreamingInserter, doc *CoatiResultsDocument, pf *coatiPowerFlow, powerFlowDir string) error {
	rows := mapCoatiPowerFlowLineLoading(inserter.modelID, doc, pf, powerFlowDir)
	if len(rows) == 0 {
		return nil
	}
	return flushRows(inserter, rows, "pypsa_line_loading")
}
