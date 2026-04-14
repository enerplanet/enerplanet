package result

import (
	"encoding/csv"
	"errors"
	"io"
	"math"
	"os"
	"path/filepath"
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
	"NAYY 4x50 SE":                    0.142,
	"NAYY 4x120 SE":                   0.230,
	"NAYY 4x150 SE":                   0.270,
	"NAYY 4x185 SE":                   0.310,
	"NAYY 4x240 SE":                   0.364,
	"NA2XS2Y 1x95 RM/25 12/20 kV":    0.255,
	"NA2XS2Y 1x150 RM/25 12/20 kV":   0.319,
	"NA2XS2Y 1x185 RM/25 12/20 kV":   0.366,
	"NA2XS2Y 1x240 RM/25 12/20 kV":   0.421,
	"NA2XS2Y 1x95 RM/25 6/10 kV":     0.255,
	"NA2XS2Y 1x185 RM/25 6/10 kV":    0.366,
	"NA2XS2Y 1x240 RM/25 6/10 kV":    0.421,
}

// readPyPSALineRatings reads lines.csv and computes s_nom (kVA) for each line
// using the cable type's i_nom rating and the line's v_nom.
func readPyPSALineRatings(extractDir string) (map[string]float64, error) {
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
