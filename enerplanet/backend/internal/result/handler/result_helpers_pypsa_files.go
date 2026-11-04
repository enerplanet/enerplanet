package result

import (
	"encoding/csv"
	"encoding/json"
	"errors"
	"io"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

type pypsaConvergenceSummary struct {
	ValidationIssues   []string `json:"validation_issues"`
	LPFMaxMismatch     float64  `json:"lpf_max_mismatch"`
	PFAttempt          string   `json:"pf_attempt"`
	ConvergedSnapshots int      `json:"converged_snapshots"`
	TotalSnapshots     int      `json:"total_snapshots"`
}

type pypsaCurtailmentPoint struct {
	Timestep    time.Time `json:"timestep"`
	AvailableKW float64   `json:"available_kw"`
	ActualKW    float64   `json:"actual_kw"`
	CurtailedKW float64   `json:"curtailed_kw"`
}

type pypsaTransformerLoadingPoint struct {
	Transformer string    `json:"transformer"`
	Timestep    time.Time `json:"timestep"`
	P0          float64   `json:"p0"`
	P1          float64   `json:"p1"`
	Q0          float64   `json:"q0"`
	Q1          float64   `json:"q1"`
	SNomKVA     float64   `json:"s_nom_kva"`
}

func (h *ResultHandler) latestExtractedPath(modelID uint) string {
	results, err := h.store.GetModelResults(modelID)
	if err != nil || len(results) == 0 {
		return ""
	}
	return results[0].ExtractedPath
}

func readPyPSAConvergenceSummary(extractDir string) (*pypsaConvergenceSummary, error) {
	// MEME main's power_flow/ export (convergence.csv + summary.json) carries
	// the verdict for full-grid-pf bundles; the legacy convergence_stats.csv
	// path below stays the fallback for old csv_sim_* bundles.
	if pfDir, err := findPyPSAPowerFlowDir(extractDir); err == nil {
		if summary, err := readPowerFlowConvergenceSummary(pfDir); err == nil {
			return summary, nil
		}
	}

	file, err := os.Open(filepath.Join(extractDir, "pypsa_output", "convergence_stats.csv"))
	if err != nil {
		return nil, err
	}
	defer file.Close()

	reader := csv.NewReader(file)
	header, err := reader.Read()
	if err != nil {
		return nil, err
	}

	row, err := reader.Read()
	if err != nil {
		return nil, err
	}

	indices := make(map[string]int, len(header))
	for i, column := range header {
		indices[strings.ToLower(strings.TrimSpace(column))] = i
	}

	summary := &pypsaConvergenceSummary{
		ValidationIssues:   parseIssueList(readCSVValue(row, indices, "validation_issues")),
		LPFMaxMismatch:     parseFloatDefault(readCSVValue(row, indices, "lpf_max_mismatch"), 0),
		PFAttempt:          readCSVValue(row, indices, "pf_attempt"),
		ConvergedSnapshots: int(parseFloatDefault(readCSVValue(row, indices, "converged_snapshots"), 0)),
		TotalSnapshots:     int(parseFloatDefault(readCSVValue(row, indices, "total_snapshots"), 0)),
	}

	return summary, nil
}

func readPyPSACurtailment(extractDir string) ([]pypsaCurtailmentPoint, error) {
	csvDir, err := findPyPSACSVDir(extractDir)
	if err != nil {
		return nil, err
	}

	webDir := filepath.Join(csvDir, "csv_web")

	actualFile, err := os.Open(filepath.Join(webDir, "generators-p-t.csv"))
	if err != nil {
		return nil, err
	}
	defer actualFile.Close()

	availableFile, err := os.Open(filepath.Join(webDir, "generators-p_set-t.csv"))
	if err != nil {
		return nil, err
	}
	defer availableFile.Close()

	actualReader := csv.NewReader(actualFile)
	availableReader := csv.NewReader(availableFile)

	actualHeader, err := actualReader.Read()
	if err != nil {
		return nil, err
	}
	availableHeader, err := availableReader.Read()
	if err != nil {
		return nil, err
	}

	if len(actualHeader) != len(availableHeader) {
		return nil, errors.New("generator CSV headers do not match")
	}

	generatorIndices := make([]int, 0, len(actualHeader))
	for i := 1; i < len(actualHeader); i++ {
		if isRenewableGeneratorName(actualHeader[i]) {
			generatorIndices = append(generatorIndices, i)
		}
	}

	points := make([]pypsaCurtailmentPoint, 0, 96)
	for {
		actualRow, actualErr := actualReader.Read()
		availableRow, availableErr := availableReader.Read()

		if actualErr == io.EOF || availableErr == io.EOF {
			break
		}
		if actualErr != nil {
			return nil, actualErr
		}
		if availableErr != nil {
			return nil, availableErr
		}

		timestamp, ok := parsePyPSATimestamp(readColumn(actualRow, 0))
		if !ok {
			continue
		}

		var availableKW, actualKW float64
		for _, idx := range generatorIndices {
			availableKW += math.Max(0, parseFloatDefault(readColumn(availableRow, idx), 0))
			actualKW += math.Max(0, parseFloatDefault(readColumn(actualRow, idx), 0))
		}

		curtailedKW := availableKW - actualKW
		if math.Abs(curtailedKW) < 1e-9 {
			curtailedKW = 0
		}
		if curtailedKW < 0 {
			curtailedKW = 0
		}

		points = append(points, pypsaCurtailmentPoint{
			Timestep:    timestamp,
			AvailableKW: availableKW,
			ActualKW:    actualKW,
			CurtailedKW: curtailedKW,
		})
	}

	return points, nil
}

func readPyPSATransformerLoading(extractDir string) ([]pypsaTransformerLoadingPoint, error) {
	// MEME main's power_flow/ export carries transformers-p0/p1/q0/q1.csv with
	// the s/s_nom loading ratio; full-grid-pf bundles have no csv_sim_* tree.
	if pfDir, err := findPyPSAPowerFlowDir(extractDir); err == nil {
		if points, err := readPowerFlowTransformerLoading(pfDir); err == nil && len(points) > 0 {
			return points, nil
		}
	}

	csvDir, err := findPyPSACSVDir(extractDir)
	if err != nil {
		return nil, err
	}

	timestamps, err := readSnapshotTimes(csvDir)
	if err != nil {
		return nil, err
	}

	ratings, err := readTransformerRatings(filepath.Join(csvDir, "transformers.csv"))
	if err != nil {
		return nil, err
	}

	p0Reader, p0File, err := openCSVReader(filepath.Join(csvDir, "transformers-p0.csv"))
	if err != nil {
		return nil, err
	}
	defer p0File.Close()

	p1Reader, p1File, err := openCSVReader(filepath.Join(csvDir, "transformers-p1.csv"))
	if err != nil {
		return nil, err
	}
	defer p1File.Close()

	q0Reader, q0File, err := openCSVReader(filepath.Join(csvDir, "transformers-q0.csv"))
	if err != nil {
		return nil, err
	}
	defer q0File.Close()

	q1Reader, q1File, err := openCSVReader(filepath.Join(csvDir, "transformers-q1.csv"))
	if err != nil {
		return nil, err
	}
	defer q1File.Close()

	p0Header, err := p0Reader.Read()
	if err != nil {
		return nil, err
	}
	if _, err := p1Reader.Read(); err != nil {
		return nil, err
	}
	if _, err := q0Reader.Read(); err != nil {
		return nil, err
	}
	if _, err := q1Reader.Read(); err != nil {
		return nil, err
	}

	transformers := p0Header[1:]
	points := make([]pypsaTransformerLoadingPoint, 0, len(transformers)*len(timestamps))
	rowIdx := 0

	for {
		p0Row, p0Err := p0Reader.Read()
		p1Row, p1Err := p1Reader.Read()
		q0Row, q0Err := q0Reader.Read()
		q1Row, q1Err := q1Reader.Read()

		if p0Err == io.EOF || p1Err == io.EOF || q0Err == io.EOF || q1Err == io.EOF {
			break
		}
		if p0Err != nil {
			return nil, p0Err
		}
		if p1Err != nil {
			return nil, p1Err
		}
		if q0Err != nil {
			return nil, q0Err
		}
		if q1Err != nil {
			return nil, q1Err
		}

		if rowIdx >= len(timestamps) {
			break
		}

		for idx, transformer := range transformers {
			points = append(points, pypsaTransformerLoadingPoint{
				Transformer: transformer,
				Timestep:    timestamps[rowIdx],
				P0:          parseFloatDefault(readColumn(p0Row, idx+1), 0) * 1000,
				P1:          parseFloatDefault(readColumn(p1Row, idx+1), 0) * 1000,
				Q0:          parseFloatDefault(readColumn(q0Row, idx+1), 0) * 1000,
				Q1:          parseFloatDefault(readColumn(q1Row, idx+1), 0) * 1000,
				SNomKVA:     ratings[transformer],
			})
		}

		rowIdx++
	}

	return points, nil
}

func findPyPSACSVDir(extractDir string) (string, error) {
	pypsaDir := filepath.Join(extractDir, "pypsa_output")
	entries, err := os.ReadDir(pypsaDir)
	if err != nil {
		return "", err
	}
	for _, entry := range entries {
		if entry.IsDir() && strings.HasPrefix(entry.Name(), "csv_sim_") {
			return filepath.Join(pypsaDir, entry.Name()), nil
		}
	}
	return "", os.ErrNotExist
}

func readSnapshotTimes(csvDir string) ([]time.Time, error) {
	file, err := os.Open(filepath.Join(csvDir, "csv_web", "snapshots-t.csv"))
	if err != nil {
		return nil, err
	}
	defer file.Close()

	reader := csv.NewReader(file)
	if _, err := reader.Read(); err != nil {
		return nil, err
	}

	timestamps := make([]time.Time, 0, 96)
	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		timestamp, ok := parsePyPSATimestamp(readColumn(row, 0))
		if !ok {
			continue
		}
		timestamps = append(timestamps, timestamp)
	}

	return timestamps, nil
}

func readTransformerRatings(path string) (map[string]float64, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	reader := csv.NewReader(file)
	header, err := reader.Read()
	if err != nil {
		return nil, err
	}

	nameIdx := indexOfColumn(header, "name")
	sNomIdx := indexOfColumn(header, "s_nom")
	if nameIdx == -1 || sNomIdx == -1 {
		return nil, errors.New("transformers.csv missing required columns")
	}

	ratings := make(map[string]float64)
	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		name := readColumn(row, nameIdx)
		if name == "" {
			continue
		}
		ratings[name] = parseFloatDefault(readColumn(row, sNomIdx), 0) * 1000
	}

	return ratings, nil
}

func openCSVReader(path string) (*csv.Reader, *os.File, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, nil, err
	}
	return csv.NewReader(file), file, nil
}

func parseIssueList(raw string) []string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" || trimmed == "[]" {
		return nil
	}
	trimmed = strings.TrimPrefix(trimmed, "[")
	trimmed = strings.TrimSuffix(trimmed, "]")
	if trimmed == "" {
		return nil
	}

	parts := strings.Split(trimmed, "',")
	issues := make([]string, 0, len(parts))
	for _, part := range parts {
		clean := strings.TrimSpace(part)
		clean = strings.Trim(clean, "'")
		clean = strings.Trim(clean, "\"")
		clean = strings.TrimSpace(clean)
		if clean != "" {
			issues = append(issues, clean)
		}
	}
	return issues
}

func readCSVValue(row []string, indices map[string]int, key string) string {
	index, ok := indices[key]
	if !ok {
		return ""
	}
	return readColumn(row, index)
}

func readColumn(row []string, index int) string {
	if index < 0 || index >= len(row) {
		return ""
	}
	return strings.TrimSpace(row[index])
}

func indexOfColumn(header []string, target string) int {
	for idx, column := range header {
		if strings.EqualFold(strings.TrimSpace(column), target) {
			return idx
		}
	}
	return -1
}

func parseFloatDefault(raw string, fallback float64) float64 {
	if raw == "" {
		return fallback
	}
	value, err := strconv.ParseFloat(strings.TrimSpace(raw), 64)
	if err != nil {
		return fallback
	}
	return value
}

func parsePyPSATimestamp(raw string) (time.Time, bool) {
	layouts := []string{
		"2006-01-02 15:04:05",
		time.RFC3339,
		"2006-01-02T15:04:05",
		"2006-01-02 15:04:05-07:00",
		"2006-01-02",
	}
	for _, layout := range layouts {
		if parsed, err := time.Parse(layout, strings.TrimSpace(raw)); err == nil {
			return parsed, true
		}
	}
	return time.Time{}, false
}

func isRenewableGeneratorName(name string) bool {
	lower := strings.ToLower(name)
	return strings.Contains(lower, "pv_supply") ||
		strings.Contains(lower, "wind_onshore") ||
		strings.Contains(lower, "wind_offshore") ||
		strings.Contains(lower, "biomass_supply") ||
		strings.Contains(lower, "hydro_supply") ||
		strings.Contains(lower, "geothermal_supply")
}

// Standard cable current ratings (i_nom in kA) from PyPSA line types database.
var standardLineTypeINom = map[string]float64{
	"NAYY 4x50 SE":                 0.142,
	"NAYY 4x120 SE":                0.230,
	"NAYY 4x150 SE":                0.270,
	"NAYY 4x185 SE":                0.310,
	"NAYY 4x240 SE":                0.364,
	"NA2XS2Y 1x95 RM/25 12/20 kV":  0.255,
	"NA2XS2Y 1x150 RM/25 12/20 kV": 0.319,
	"NA2XS2Y 1x185 RM/25 12/20 kV": 0.366,
	"NA2XS2Y 1x240 RM/25 12/20 kV": 0.421,
	"NA2XS2Y 1x95 RM/25 6/10 kV":   0.255,
	"NA2XS2Y 1x185 RM/25 6/10 kV":  0.366,
	"NA2XS2Y 1x240 RM/25 6/10 kV":  0.421,
}

// readPyPSALineRatings reads lines.csv and computes s_nom (kVA) for each line
// using the cable type's i_nom rating and the line's v_nom.
func readPyPSALineRatings(extractDir string) (map[string]float64, error) {
	// MEME main's power_flow/ export carries lines-p0/p1/q0/q1.csv + the
	// s/s_nom loading ratio; full-grid-pf bundles have no lines.csv.
	if pfDir, err := findPyPSAPowerFlowDir(extractDir); err == nil {
		if ratings, err := readPowerFlowLineRatings(pfDir); err == nil && len(ratings) > 0 {
			return ratings, nil
		}
	}

	csvDir, err := findPyPSACSVDir(extractDir)
	if err != nil {
		return nil, err
	}

	file, err := os.Open(filepath.Join(csvDir, "lines.csv"))
	if err != nil {
		return nil, err
	}
	defer file.Close()

	reader := csv.NewReader(file)
	header, err := reader.Read()
	if err != nil {
		return nil, err
	}

	nameIdx := indexOfColumn(header, "name")
	typeIdx := indexOfColumn(header, "type")
	vNomIdx := indexOfColumn(header, "v_nom")
	numParallelIdx := indexOfColumn(header, "num_parallel")
	if nameIdx == -1 || typeIdx == -1 || vNomIdx == -1 {
		return nil, errors.New("lines.csv missing required columns")
	}

	ratings := make(map[string]float64)
	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}

		name := readColumn(row, nameIdx)
		lineType := readColumn(row, typeIdx)
		vNom := parseFloatDefault(readColumn(row, vNomIdx), 0)
		numParallel := 1.0
		if numParallelIdx != -1 {
			numParallel = parseFloatDefault(readColumn(row, numParallelIdx), 1)
		}

		if name == "" || vNom <= 0 {
			continue
		}

		iNom, ok := standardLineTypeINom[lineType]
		if !ok {
			continue
		}

		// s_nom = sqrt(3) * v_nom(kV) * i_nom(kA) * num_parallel = MVA, then * 1000 for kVA
		sNomKVA := math.Sqrt(3) * vNom * iNom * numParallel * 1000
		ratings[name] = sNomKVA
	}

	return ratings, nil
}

// ---------------------------------------------------------------------------
// MEME main's power_flow/ layout (full-grid-pf bundles)
//
// MEME main (the canonical "power_flow" mode) exports output/power_flow/{...}
// next to network.nc instead of the legacy pypsa_output/csv_sim_* tree:
//   convergence.csv            first column = snapshot label, then per-snapshot
//                              "converged" bool and "iterations"
//   summary.json               {method, slack, slack_bus, snapshots, ...}
//   lines-p0/p1/q0/q1/loading.csv, transformers-p0/p1/q0/q1/loading.csv
//                              snapshots down, components across, first column
//                              the snapshot label; *_loading.csv are unitless
//                              s/s_nom ratios (NOT percents).
// The legacy readers above keep serving old bundles unchanged; the functions
// below consume the canonical layout, keeping the same wire types/units
// (p/q MW/MVAr -> kW/kVAr x1000, ratings kVA, convergence snapshot counts).
// ---------------------------------------------------------------------------

// findPyPSAPowerFlowDir returns the MEME-main power_flow/ export directory: a
// directory named exactly "power_flow" carrying the MEME marker files
// (convergence.csv or summary.json) that the legacy csv_sim_*/pypsa_output
// layouts never contain. A path under a "pypsa" segment (the multi-target
// layout files/pypsa/run_<i>/output/power_flow) is preferred so a bundle
// holding several legs is not misread.
func findPyPSAPowerFlowDir(extractDir string) (string, error) {
	var first, preferred string
	_ = filepath.WalkDir(extractDir, func(path string, d os.DirEntry, err error) error {
		if err != nil || !d.IsDir() || d.Name() != "power_flow" {
			return nil
		}
		if !hasPowerFlowMarker(path) {
			return nil
		}
		if first == "" {
			first = path
		}
		if strings.Contains(strings.ToLower(path), "pypsa") {
			preferred = path
			return filepath.SkipAll
		}
		return nil
	})
	if preferred != "" {
		return preferred, nil
	}
	if first != "" {
		return first, nil
	}
	return "", os.ErrNotExist
}

// hasPowerFlowMarker reports whether the directory holds one of the files MEME
// main always writes into power_flow/.
func hasPowerFlowMarker(pfDir string) bool {
	for _, name := range []string{"convergence.csv", "summary.json"} {
		if _, err := os.Stat(filepath.Join(pfDir, name)); err == nil {
			return true
		}
	}
	return false
}

// pypsaPowerFlowTable is one MEME power_flow table: the snapshot labels (the
// first column, written with index_label="snapshot") and the per-component
// numeric series behind them. Row order is identical across tables — every one
// is written from the same snapshot index. Values the CSV cannot parse
// (diverged snapshots are NaN cells) stay NaN so the callers' guards handle
// them explicitly.
type pypsaPowerFlowTable struct {
	labels []string
	order  []string
	values map[string][]float64
}

// readPyPSAPowerFlowTable reads one MEME power_flow table (snapshots down,
// components across) into labels + per-component series.
func readPyPSAPowerFlowTable(pfDir, name string) (*pypsaPowerFlowTable, error) {
	file, err := os.Open(filepath.Join(pfDir, name))
	if err != nil {
		return nil, err
	}
	defer file.Close()

	reader := csv.NewReader(file)
	header, err := reader.Read()
	if err != nil {
		return nil, err
	}

	tbl := &pypsaPowerFlowTable{values: make(map[string][]float64, len(header)-1)}
	series := make([][]float64, len(header)-1)
	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		if len(row) > 0 {
			tbl.labels = append(tbl.labels, strings.TrimSpace(row[0]))
		}
		for i := 1; i < len(row) && i-1 < len(series); i++ {
			series[i-1] = append(series[i-1], parseFloatDefault(readColumn(row, i), math.NaN()))
		}
	}
	for i := 1; i < len(header); i++ {
		name := strings.TrimSpace(header[i])
		if name == "" {
			continue
		}
		tbl.order = append(tbl.order, name)
		tbl.values[name] = series[i-1]
	}
	return tbl, nil
}

// readPowerFlowConvergenceSummary reads the power-flow verdict from the MEME
// power_flow/ export: summary.json's aggregate counts (its "snapshots" key is
// the total — the legacy name "total_snapshots" does not exist there),
// falling back to counting the per-snapshot convergence.csv rows. The legacy
// validation_issues/lpf_max_mismatch/pf_attempt fields have no equivalent in
// the new layout and stay empty/zero.
func readPowerFlowConvergenceSummary(pfDir string) (*pypsaConvergenceSummary, error) {
	if raw, err := os.ReadFile(filepath.Join(pfDir, "summary.json")); err == nil {
		var summary struct {
			Snapshots          int `json:"snapshots"`
			ConvergedSnapshots int `json:"converged_snapshots"`
		}
		if jsonErr := json.Unmarshal(raw, &summary); jsonErr == nil && summary.Snapshots > 0 {
			return &pypsaConvergenceSummary{
				ConvergedSnapshots: summary.ConvergedSnapshots,
				TotalSnapshots:     summary.Snapshots,
			}, nil
		}
	}

	file, err := os.Open(filepath.Join(pfDir, "convergence.csv"))
	if err != nil {
		return nil, err
	}
	defer file.Close()

	reader := csv.NewReader(file)
	header, err := reader.Read()
	if err != nil {
		return nil, err
	}
	convIdx := indexOfColumn(header, "converged")

	summary := &pypsaConvergenceSummary{}
	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		summary.TotalSnapshots++
		if convIdx >= 0 && convIdx < len(row) && csvBoolTrue(readColumn(row, convIdx)) {
			summary.ConvergedSnapshots++
		}
	}
	if summary.TotalSnapshots == 0 {
		return nil, errors.New("convergence.csv has no snapshot rows")
	}
	return summary, nil
}

// csvBoolTrue reports whether a cell reads as a boolean true. pandas writes
// Python bools (True/False); accept 1/0 as well.
func csvBoolTrue(raw string) bool {
	if v, err := strconv.ParseBool(strings.TrimSpace(raw)); err == nil {
		return v
	}
	return parseFloatDefault(raw, 0) == 1
}

// finiteOrZero maps NaN/±Inf (a diverged snapshot's cells) to 0 so the
// section stays JSON-serializable — encoding/json rejects non-finite floats.
func finiteOrZero(v float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return v
}

// valueAtSeries returns series[i], 0 when out of range (a missing table or a
// ragged row reads as no value).
func valueAtSeries(series []float64, i int) float64 {
	if i < 0 || i >= len(series) {
		return 0
	}
	return series[i]
}

// medianFloat returns the median of the estimates — each should approximate
// the same constant — or 0 when there are none.
func medianFloat(values []float64) float64 {
	if len(values) == 0 {
		return 0
	}
	sorted := append([]float64(nil), values...)
	sort.Float64s(sorted)
	return sorted[len(sorted)/2]
}

// powerFlowBranchRatings derives each branch's s_nom (MVA) from its flow
// tables and the MEME loading ratio. MEME computes
// loading = max(|s0|, |s1|) / s_nom, so s_nom = max(|s0|, |s1|) / loading —
// exact up to float noise on every snapshot that carries flow. The reactive
// end counts only when the q0/q1 tables exist (MEME includes q in the loading
// only when the network has reactive data). A branch that never carries flow
// (loading 0) yields no estimate -> s_nom 0. Values are NaN-safe: a
// diverged snapshot's NaN cells fail the magnitude guards and are skipped.
func powerFlowBranchRatings(pfDir, prefix string) (map[string]float64, error) {
	p0, err := readPyPSAPowerFlowTable(pfDir, prefix+"-p0.csv")
	if err != nil {
		return nil, err
	}
	loading, err := readPyPSAPowerFlowTable(pfDir, prefix+"-loading.csv")
	if err != nil {
		return nil, err
	}
	p1, _ := readPyPSAPowerFlowTable(pfDir, prefix+"-p1.csv")
	q0, _ := readPyPSAPowerFlowTable(pfDir, prefix+"-q0.csv")
	q1, _ := readPyPSAPowerFlowTable(pfDir, prefix+"-q1.csv")

	branches := append([]string(nil), p0.order...)
	estimates := make(map[string][]float64, len(branches))
	n := len(p0.labels)
	for _, name := range branches {
		p0s := p0.values[name]
		var p1s, q0s, q1s []float64
		if p1 != nil {
			p1s = p1.values[name]
		}
		if q0 != nil {
			q0s = q0.values[name]
		}
		if q1 != nil {
			q1s = q1.values[name]
		}
		loads := loading.values[name]
		var est []float64
		for i := 0; i < n; i++ {
			p0v := valueAtSeries(p0s, i)
			p1v := valueAtSeries(p1s, i)
			s0 := math.Abs(p0v)
			s1 := math.Abs(p1v)
			if q0 != nil {
				s0 = math.Hypot(p0v, valueAtSeries(q0s, i))
			}
			if q1 != nil {
				s1 = math.Hypot(p1v, valueAtSeries(q1s, i))
			}
			s := math.Max(s0, s1)
			load := valueAtSeries(loads, i)
			if s > 1e-9 && load > 1e-9 {
				est = append(est, s/load)
			}
		}
		estimates[name] = est
	}

	ratings := make(map[string]float64, len(branches))
	for _, name := range branches {
		ratings[name] = medianFloat(estimates[name])
	}
	return ratings, nil
}

// readPowerFlowTransformerLoading reads the transformer flows
// (transformers-p0/p1/q0/q1.csv, MW/MVAr -> kW/kVAr x1000) with the
// s_nom (kVA) derived from the s/s_nom loading ratio. Timestamps come from the
// tables' own snapshot labels (MEME main has no csv_web/snapshots-t.csv); a
// snapshot whose label does not parse is dropped for the whole row, keeping
// the p/q/loading series aligned.
func readPowerFlowTransformerLoading(pfDir string) ([]pypsaTransformerLoadingPoint, error) {
	ratings, err := powerFlowBranchRatings(pfDir, "transformers")
	if err != nil {
		return nil, err
	}
	p0, err := readPyPSAPowerFlowTable(pfDir, "transformers-p0.csv")
	if err != nil {
		return nil, err
	}
	p1, _ := readPyPSAPowerFlowTable(pfDir, "transformers-p1.csv")
	q0, _ := readPyPSAPowerFlowTable(pfDir, "transformers-q0.csv")
	q1, _ := readPyPSAPowerFlowTable(pfDir, "transformers-q1.csv")

	points := make([]pypsaTransformerLoadingPoint, 0, len(p0.order)*len(p0.labels))
	for i, label := range p0.labels {
		timestamp, ok := parsePyPSATimestamp(label)
		if !ok {
			continue // unparseable snapshot label: drop this row entirely
		}
		for _, name := range p0.order {
			p0v := valueAtSeries(p0.values[name], i)
			p1v := 0.0
			if p1 != nil {
				p1v = valueAtSeries(p1.values[name], i)
			}
			var q0v, q1v float64
			if q0 != nil {
				q0v = valueAtSeries(q0.values[name], i)
			}
			if q1 != nil {
				q1v = valueAtSeries(q1.values[name], i)
			}
			points = append(points, pypsaTransformerLoadingPoint{
				Transformer: name,
				Timestep:    timestamp,
				P0:          finiteOrZero(p0v) * 1000,
				P1:          finiteOrZero(p1v) * 1000,
				Q0:          finiteOrZero(q0v) * 1000,
				Q1:          finiteOrZero(q1v) * 1000,
				SNomKVA:     ratings[name] * 1000,
			})
		}
	}
	return points, nil
}

// readPowerFlowLineRatings derives the line ratings (name -> kVA) from the
// lines-*.csv flow tables and the s/s_nom loading ratio, mirroring
// readPyPSALineRatings's contract for the legacy layout. A line that never
// carries flow yields no rating and is skipped (the legacy reader likewise
// skips lines whose cable type is unknown).
func readPowerFlowLineRatings(pfDir string) (map[string]float64, error) {
	ratings, err := powerFlowBranchRatings(pfDir, "lines")
	if err != nil {
		return nil, err
	}
	out := make(map[string]float64, len(ratings))
	for name, sNomMVA := range ratings {
		if sNomMVA > 0 {
			out[name] = sNomMVA * 1000
		}
	}
	return out, nil
}
