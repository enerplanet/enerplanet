package resultservice

import (
	"encoding/csv"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"platform.local/platform/logger"
)

var errCSVSimDirNotFound = errors.New("csv_sim_* directory not found")

const (
	fileInputsLocCoordinates = "inputs_loc_coordinates.csv"
	fileResultsCarrierProd   = "results_carrier_prod.csv"
	fileResultsCarrierCon    = "results_carrier_con.csv"
	dateFormatSpace          = "2006-01-02 15:04:05"
	dateFormatT              = "2006-01-02T15:04:05"
	logParsingFmt            = "Parsing %s..."
)

type parseStep struct {
	name     string
	fn       func(*ParsedResults) error
	required bool
}

var RequiredCalliopeFiles = []string{
	fileInputsLocCoordinates,
	"inputs_lookup_loc_techs.csv",
	"results_systemwide_capacity_factor.csv",
	"results_systemwide_levelised_cost.csv",
	"results_total_levelised_cost.csv",
	"results_capacity_factor.csv",
	fileResultsCarrierProd,
	fileResultsCarrierCon,
	"results_cost.csv",
	"results_cost_var.csv",
	"results_energy_cap.csv",
}

var RequiredPyPSAFiles = []string{
	"settings.csv",
	"pf_result.csv",
}

type ParsedResults struct {
	Coordinates              map[string]Coordinate      `json:"coordinates"`
	LocTechs                 map[string][]string        `json:"loc_techs"`
	SystemwideCapacityFactor []SystemwideCapacityFactor `json:"systemwide_capacity_factor"`
	SystemwideLevelisedCost  []SystemwideLevelisedCost  `json:"systemwide_levelised_cost"`
	TotalLevelisedCost       []TotalLevelisedCost       `json:"total_levelised_cost"`
	CapacityFactor           []CapacityFactorRecord     `json:"capacity_factor"`
	CarrierProd              []CarrierRecord            `json:"carrier_prod"`
	CarrierCon               []CarrierRecord            `json:"carrier_con"`
	Cost                     []CostRecord               `json:"cost"`
	CostVar                  []CostVarRecord            `json:"cost_var"`
	EnergyCap                []EnergyCap                `json:"energy_cap"`
	SystemBalance            []SystemBalanceRecord      `json:"system_balance"`
	UnmetDemand              []UnmetDemandRecord        `json:"unmet_demand"`
	ResourceCon              []ResourceConRecord        `json:"resource_con"`
	CostInvestment           []CostInvestmentRecord     `json:"cost_investment"`
	PyPSAVoltage             []PyPSAVoltageRecord       `json:"pypsa_voltage"`
	PyPSAPower               []PyPSAPowerRecord         `json:"pypsa_power"`
	LineFlows                []LineFlowRecord           `json:"line_flows"`
	TrafoFlows               []TransformerFlowRecord    `json:"trafo_flows"`
	SumProduction            float64                    `json:"sum_production"`
	SumConsumption           float64                    `json:"sum_consumption"`
	PyPSA                    *PyPSAResults              `json:"pypsa,omitempty"`
}

type Coordinate struct {
	X float64 `json:"x"`
	Y float64 `json:"y"`
}

type SystemwideCapacityFactor struct {
	Carrier string  `json:"carrier"`
	Techs   string  `json:"techs"`
	Value   float64 `json:"value"`
}

type SystemwideLevelisedCost struct {
	Carrier string  `json:"carrier"`
	Costs   string  `json:"costs"`
	Techs   string  `json:"techs"`
	Value   float64 `json:"value"`
}

type TotalLevelisedCost struct {
	Carrier string  `json:"carrier"`
	Costs   string  `json:"costs"`
	Value   float64 `json:"value"`
}

type CapacityFactorRecord struct {
	FromLocation string     `json:"from_location"`
	ToLocation   string     `json:"to_location,omitempty"`
	Carrier      string     `json:"carrier"`
	Techs        string     `json:"techs"`
	Timestep     *time.Time `json:"timestep,omitempty"`
	Value        float64    `json:"value"`
}

type CarrierRecord struct {
	FromLocation string    `json:"from_location"`
	ToLocation   string    `json:"to_location,omitempty"`
	Carrier      string    `json:"carrier"`
	Techs        string    `json:"techs"`
	Timestep     time.Time `json:"timestep"`
	Value        float64   `json:"value"`
}

type CostRecord struct {
	FromLocation string  `json:"from_location"`
	ToLocation   string  `json:"to_location,omitempty"`
	Costs        string  `json:"costs"`
	Techs        string  `json:"techs"`
	Value        float64 `json:"value"`
}

type CostVarRecord struct {
	Location string    `json:"location"`
	Costs    string    `json:"costs"`
	Techs    string    `json:"techs"`
	Timestep time.Time `json:"timestep"`
	Value    float64   `json:"value"`
}

type EnergyCap struct {
	Location string  `json:"location"`
	Tech     string  `json:"tech"`
	ToLoc    string  `json:"to_loc,omitempty"`
	Value    float64 `json:"value"`
}

type PyPSAResults struct {
	VoltLV        string `json:"volt_lv"`
	VoltMV        string `json:"volt_mv,omitempty"`
	TrafoTypeMVLV string `json:"trafo_type_mv_lv,omitempty"`
	LineTypeLV    string `json:"line_type_lv"`
	LineTypeMV    string `json:"line_type_mv"`
	Converged     bool   `json:"converged"`
}

type PyPSAVoltageRecord struct {
	Bus      string    `json:"bus"`
	Location string    `json:"location"`
	Timestep time.Time `json:"timestep"`
	VMagPu   float64   `json:"v_mag_pu"`
	VAng     *float64  `json:"v_ang,omitempty"`
}

type PyPSAPowerRecord struct {
	Bus      string    `json:"bus"`
	Location string    `json:"location"`
	Timestep time.Time `json:"timestep"`
	P        float64   `json:"p"`
	Q        *float64  `json:"q,omitempty"`
}

type SystemBalanceRecord struct {
	Carrier  string    `json:"carrier"`
	Location string    `json:"location"`
	Timestep time.Time `json:"timestep"`
	Value    float64   `json:"value"`
}

type UnmetDemandRecord struct {
	Carrier  string    `json:"carrier"`
	Location string    `json:"location"`
	Timestep time.Time `json:"timestep"`
	Value    float64   `json:"value"`
}

type ResourceConRecord struct {
	Location string    `json:"location"`
	Tech     string    `json:"tech"`
	Timestep time.Time `json:"timestep"`
	Value    float64   `json:"value"`
}

type CostInvestmentRecord struct {
	Costs    string  `json:"costs"`
	Location string  `json:"location"`
	Tech     string  `json:"tech"`
	Value    float64 `json:"value"`
}

type LineFlowRecord struct {
	Line     string    `json:"line"`
	Timestep time.Time `json:"timestep"`
	P0       float64   `json:"p0"`
	P1       float64   `json:"p1"`
}

type TransformerFlowRecord struct {
	Transformer string    `json:"transformer"`
	Timestep    time.Time `json:"timestep"`
	P0          float64   `json:"p0"`
	P1          float64   `json:"p1"`
}

type ResultParser struct {
	extractDir string
	resultsDir string
	pypsaDir   string
	pypsa      bool
}

func NewResultParser(extractDir string, hasPypsa bool) *ResultParser {
	return &ResultParser{
		extractDir: extractDir,
		pypsa:      hasPypsa,
	}
}

type csvColumnIndices struct {
	carrier, locs, techs, timesteps, value int
}

func findColumnIndices(header []string, valueAlt string) csvColumnIndices {
	idx := csvColumnIndices{-1, -1, -1, -1, -1}
	for i, h := range header {
		switch strings.ToLower(h) {
		case "carriers":
			idx.carrier = i
		case "locs":
			idx.locs = i
		case "techs":
			idx.techs = i
		case "timesteps":
			idx.timesteps = i
		case "value":
			idx.value = i
		default:
			if strings.ToLower(h) == valueAlt {
				idx.value = i
			}
		}
	}
	return idx
}

func parseTimestamp(s string) (time.Time, bool) {
	if s == "" {
		return time.Time{}, false
	}
	// Prefer RFC3339, then other formats
	if ts, err := time.Parse(time.RFC3339, s); err == nil {
		return ts.UTC(), true
	}
	if ts, err := time.Parse(dateFormatT, s); err == nil {
		return ts.UTC(), true
	}
	if ts, err := time.Parse(dateFormatSpace, s); err == nil {
		return ts.UTC(), true
	}
	return time.Time{}, false
}

func parseLocationParts(s string) (from, to string) {
	parts := strings.SplitN(s, "::", 2)
	from = parts[0]
	if len(parts) > 1 {
		to = parts[1]
	}
	return
}

func safeGetString(row []string, idx int) string {
	if idx >= 0 && idx < len(row) {
		return strings.TrimSpace(row[idx])
	}
	return ""
}

func normalizeNumberString(raw string) string {
	s := strings.TrimSpace(raw)
	if s == "" {
		return s
	}

	// Remove any spaces (sometimes used as thousands separator)
	s = strings.ReplaceAll(s, " ", "")

	dot := strings.LastIndex(s, ".")
	comma := strings.LastIndex(s, ",")

	// Heuristic: If both are present, the one that appears later is the decimal separator.
	if dot >= 0 && comma >= 0 {
		if comma > dot {
			// Comma is decimal (e.g. 1.234,56)
			s = strings.ReplaceAll(s, ".", "")
			s = strings.ReplaceAll(s, ",", ".")
		} else {
			// Dot is decimal (e.g. 1,234.56)
			s = strings.ReplaceAll(s, ",", "")
		}
		return s
	}

	// Only comma present: 1,234 or 1,23
	if comma >= 0 && dot == -1 {
		parts := strings.Split(s, ",")
		// If more than one comma, it's a thousands separator
		if len(parts) > 2 {
			return strings.Join(parts, "")
		}
		// Single comma: check if it's likely a thousands separator (e.g. 1,000) or decimal (e.g. 1,23)
		if len(parts[1]) == 3 {
			// Ambiguous, but in energy data 1,000 is usually a thousand
			return parts[0] + parts[1]
		}
		return parts[0] + "." + parts[1]
	}

	return s
}

func parseCSVFloat(raw string) (float64, error) {
	s := normalizeNumberString(raw)
	if s == "" {
		return 0, fmt.Errorf("empty numeric value")
	}

	v, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, err
	}
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0, fmt.Errorf("non-finite numeric value: %s", raw)
	}

	return v, nil
}

func safeParseFloat(row []string, idx int) (float64, bool) {
	if idx < 0 || idx >= len(row) {
		return 0, false
	}
	v, err := parseCSVFloat(row[idx])
	if err != nil {
		return 0, false
	}
	return v, true
}

type csvRowProcessor func(row []string, indices []int) error

func readCSVWithColumns(filePath string, columns []string, processor csvRowProcessor) error {
	file, err := os.Open(filePath)
	if err != nil {
		return err
	}
	defer file.Close()

	reader := csv.NewReader(file)
	header, err := reader.Read()
	if err != nil {
		return err
	}

	normalizedHeader := make([]string, len(header))
	for i, h := range header {
		normalizedHeader[i] = strings.ToLower(strings.TrimSpace(h))
	}

	indices := make([]int, len(columns))
	var missing []string
	for i, col := range columns {
		indices[i] = -1
		target := strings.ToLower(strings.TrimSpace(col))
		for j, h := range normalizedHeader {
			if h == target {
				indices[i] = j
				break
			}
		}
		if indices[i] == -1 {
			missing = append(missing, col)
		}
	}

	if len(missing) > 0 {
		return fmt.Errorf("missing required columns in %s: %s", filepath.Base(filePath), strings.Join(missing, ", "))
	}

	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if err := processor(row, indices); err != nil {
			return err
		}
	}
	return nil
}

func findCSVSimDir(pypsaDir string) (string, error) {
	entries, err := os.ReadDir(pypsaDir)
	if err != nil {
		return "", err
	}
	for _, entry := range entries {
		if entry.IsDir() && strings.HasPrefix(entry.Name(), "csv_sim_") {
			return filepath.Join(pypsaDir, entry.Name()), nil
		}
	}
	return "", errCSVSimDirNotFound
}

func parseSnapshotsCSV(csvDir string) ([]time.Time, error) {
	paths := []string{
		filepath.Join(csvDir, "csv_web", "snapshots-t.csv"),
		filepath.Join(csvDir, "snapshots.csv"),
	}

	for _, path := range paths {
		file, err := os.Open(path)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}

		reader := csv.NewReader(file)
		header, err := reader.Read()
		if err != nil {
			file.Close()
			return nil, err
		}

		timestampIdx := -1
		for i, col := range header {
			if strings.EqualFold(strings.TrimSpace(col), "timesteps") {
				timestampIdx = i
				break
			}
		}
		if timestampIdx == -1 {
			timestampIdx = 0
		}

		var timestamps []time.Time
		for {
			row, err := reader.Read()
			if err == io.EOF {
				break
			}
			if err != nil {
				file.Close()
				return nil, err
			}
			if timestampIdx < len(row) {
				if ts, ok := parseTimestamp(row[timestampIdx]); ok {
					timestamps = append(timestamps, ts)
				}
			}
		}
		file.Close()

		if len(timestamps) > 0 {
			return timestamps, nil
		}
	}

	return nil, fmt.Errorf("no parseable timestamps found in snapshots CSV under %s", csvDir)
}

func (p *ResultParser) locateDirectories() error {
	return filepath.Walk(p.extractDir, func(path string, info os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		if !info.IsDir() {
			return nil
		}
		if info.Name() == "results" {
			p.resultsDir = path
		}
		if strings.HasPrefix(info.Name(), "pypsa") {
			p.pypsaDir = path
		}
		return nil
	})
}

func (p *ResultParser) checkRootForResults() {
	if p.resultsDir == "" {
		if _, err := os.Stat(filepath.Join(p.extractDir, fileInputsLocCoordinates)); err == nil {
			p.resultsDir = p.extractDir
		}
	}
}

func validateRequiredFiles(dir string, files []string, errPrefix string) error {
	for _, file := range files {
		path := filepath.Join(dir, file)
		if _, err := os.Stat(path); os.IsNotExist(err) {
			return fmt.Errorf("%s: %s", errPrefix, file)
		}
	}
	return nil
}

func (p *ResultParser) ValidateAndLocateFiles() error {

	if err := p.locateDirectories(); err != nil {
		return fmt.Errorf("failed to scan directory: %w", err)
	}

	p.checkRootForResults()

	if p.resultsDir == "" {
		return fmt.Errorf("could not find results directory")
	}

	if err := validateRequiredFiles(p.resultsDir, RequiredCalliopeFiles, "missing required file"); err != nil {
		return err
	}

	if p.pypsa && p.pypsaDir != "" {
		if err := validateRequiredFiles(p.pypsaDir, RequiredPyPSAFiles, "missing required PyPSA file"); err != nil {
			return err
		}
	}

	return nil
}

// ParseSummary parses only small/summary data that fits in memory.
// Large time-series data (capacity_factor, carrier_prod, carrier_con, cost_var,
// system_balance, unmet_demand, resource_con, pypsa voltage/power/line/trafo flows)
// is skipped — it will be streamed directly from CSV to DB.
func (p *ResultParser) ParseSummary() (*ParsedResults, error) {
	log := logger.ForComponent("result_parser")

	results := &ParsedResults{
		Coordinates: make(map[string]Coordinate),
		LocTechs:    make(map[string][]string),
	}

	requiredSteps := []parseStep{
		{"coordinates", p.parseCoordinates, true},
		{"location techs", p.parseLocTechs, true},
		{"systemwide capacity factor", p.parseSystemwideCapacityFactor, true},
		{"systemwide levelised cost", p.parseSystemwideLevelisedCost, true},
		{"total levelised cost", p.parseTotalLevelisedCost, true},
		{"energy capacity", p.parseEnergyCap, true},
	}

	optionalSteps := []parseStep{
		{"total cost", p.parseCost, false},
		{"investment cost", p.parseCostInvestment, false},
	}

	for _, step := range requiredSteps {
		if err := step.fn(results); err != nil {
			return nil, fmt.Errorf("failed to parse %s: %w", step.name, err)
		}
	}

	for _, step := range optionalSteps {
		if err := step.fn(results); err != nil {
			if !os.IsNotExist(err) {
				log.Debugf("Optional parse step %s: %v", step.name, err)
			}
		}
	}

	// Parse PyPSA settings only (not time-series voltage/power/flows)
	if p.pypsa && p.pypsaDir != "" {
		pypsa, err := p.parsePyPSA()
		if err != nil {
			if !os.IsNotExist(err) {
				log.Debugf("PyPSA settings parsing: %v", err)
			}
		} else {
			results.PyPSA = pypsa
		}
	}

	return results, nil
}

// DetectPowerScaleFromEnergyCap detects the power normalization scale using
// only the in-memory EnergyCap data. Falls back to a quick streaming scan
// of the carrier_con CSV if EnergyCap has no demand techs.
func (p *ResultParser) DetectPowerScaleFromEnergyCap(energyCap []EnergyCap) float64 {
	maxDemand := 0.0

	// Try EnergyCap first (already in memory)
	for _, ec := range energyCap {
		if !isDemandTech(ec.Tech) {
			continue
		}
		v := math.Abs(ec.Value)
		if v > maxDemand {
			maxDemand = v
		}
	}

	// Fallback: quick streaming scan of carrier_con CSV
	if maxDemand == 0 {
		filePath := filepath.Join(p.resultsDir, fileResultsCarrierCon)
		file, err := os.Open(filePath)
		if err == nil {
			defer file.Close()
			reader := csv.NewReader(file)
			header, err := reader.Read()
			if err == nil {
				idx := findColumnIndices(header, "carrier_con")
				for {
					row, err := reader.Read()
					if err != nil {
						break
					}
					carrier := safeGetString(row, idx.carrier)
					techs := safeGetString(row, idx.techs)
					if carrier != "power" || !isDemandTech(techs) {
						continue
					}
					v, ok := safeParseFloat(row, idx.value)
					if !ok {
						continue
					}
					v = math.Abs(v)
					if v > maxDemand {
						maxDemand = v
					}
				}
			}
		}
	}

	return inferCalliopePowerScale(maxDemand)
}

func (p *ResultParser) CollectPowerTechs() map[string]struct{} {
	powerTechs := make(map[string]struct{})

	scanFile := func(filePath, valueAlt string) {
		file, err := os.Open(filePath)
		if err != nil {
			return
		}
		defer file.Close()

		reader := csv.NewReader(file)
		header, err := reader.Read()
		if err != nil {
			return
		}
		idx := findColumnIndices(header, valueAlt)

		for {
			row, err := reader.Read()
			if err != nil {
				break
			}
			carrier := safeGetString(row, idx.carrier)
			if carrier == "power" {
				techs := safeGetString(row, idx.techs)
				powerTechs[techBase(techs)] = struct{}{}
			}
		}
	}

	scanFile(filepath.Join(p.resultsDir, fileResultsCarrierProd), "carrier_prod")
	scanFile(filepath.Join(p.resultsDir, fileResultsCarrierCon), "carrier_con")

	return powerTechs
}

// ResultsDir returns the resolved results directory path.
func (p *ResultParser) ResultsDir() string {
	return p.resultsDir
}

// PyPSADir returns the resolved pypsa directory path.
func (p *ResultParser) PyPSADir() string {
	return p.pypsaDir
}

// HasPyPSA returns whether pypsa processing is enabled.
func (p *ResultParser) HasPyPSA() bool {
	return p.pypsa && p.pypsaDir != ""
}

func techBase(tech string) string {
	if tech == "" {
		return ""
	}
	return strings.SplitN(tech, ":", 2)[0]
}

func isDemandTech(tech string) bool {
	return strings.HasSuffix(strings.ToLower(techBase(tech)), "_demand")
}

func inferCalliopePowerScale(maxDemand float64) float64 {
	if maxDemand <= 0 {
		return 1
	}

	// Legacy MW payloads.
	if maxDemand < 0.01 {
		return 1000 // MW -> kW
	}

	return 1 // Calliope outputs are in kW
}

func (p *ResultParser) parseCoordinates(results *ParsedResults) error {
	filePath := filepath.Join(p.resultsDir, fileInputsLocCoordinates)
	columns := []string{"coordinates", "locs", "loc_coordinates"}

	return readCSVWithColumns(filePath, columns, func(row []string, idx []int) error {
		locID := safeGetString(row, idx[1])
		coord := strings.ToLower(safeGetString(row, idx[0]))
		if locID == "" || (coord != "x" && coord != "y") {
			return nil
		}

		value, ok := safeParseFloat(row, idx[2])
		if !ok {
			return nil
		}

		c := results.Coordinates[locID]
		if coord == "x" {
			c.X = value
		} else {
			c.Y = value
		}
		results.Coordinates[locID] = c
		return nil
	})
}

func (p *ResultParser) parseLocTechs(results *ParsedResults) error {
	file, err := os.Open(filepath.Join(p.resultsDir, "inputs_lookup_loc_techs.csv"))
	if err != nil {
		return err
	}
	defer file.Close()

	reader := csv.NewReader(file)
	_, _ = reader.Read() // Skip header

	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if len(row) < 2 {
			continue
		}

		locID := row[0]
		tech := row[1]

		results.LocTechs[locID] = append(results.LocTechs[locID], tech)
	}

	return nil
}

func (p *ResultParser) parseSystemwideCapacityFactor(results *ParsedResults) error {
	file, err := os.Open(filepath.Join(p.resultsDir, "results_systemwide_capacity_factor.csv"))
	if err != nil {
		return err
	}
	defer file.Close()

	reader := csv.NewReader(file)
	_, _ = reader.Read() // Skip header

	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if len(row) < 3 {
			continue
		}

		value, err := parseCSVFloat(row[2])
		if err != nil {
			continue
		}
		results.SystemwideCapacityFactor = append(results.SystemwideCapacityFactor, SystemwideCapacityFactor{
			Carrier: row[0],
			Techs:   row[1],
			Value:   value,
		})
	}

	return nil
}

func (p *ResultParser) parseSystemwideLevelisedCost(results *ParsedResults) error {
	file, err := os.Open(filepath.Join(p.resultsDir, "results_systemwide_levelised_cost.csv"))
	if err != nil {
		return err
	}
	defer file.Close()

	reader := csv.NewReader(file)
	_, _ = reader.Read() // Skip header

	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if len(row) < 4 {
			continue
		}

		value, err := parseCSVFloat(row[3])
		if err != nil {
			continue
		}
		results.SystemwideLevelisedCost = append(results.SystemwideLevelisedCost, SystemwideLevelisedCost{
			Carrier: row[0],
			Costs:   row[1],
			Techs:   row[2],
			Value:   value,
		})
	}

	return nil
}

func (p *ResultParser) parseTotalLevelisedCost(results *ParsedResults) error {
	file, err := os.Open(filepath.Join(p.resultsDir, "results_total_levelised_cost.csv"))
	if err != nil {
		return err
	}
	defer file.Close()

	reader := csv.NewReader(file)
	_, _ = reader.Read() // Skip header

	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if len(row) < 3 {
			continue
		}

		value, err := parseCSVFloat(row[2])
		if err != nil {
			continue
		}
		results.TotalLevelisedCost = append(results.TotalLevelisedCost, TotalLevelisedCost{
			Carrier: row[0],
			Costs:   row[1],
			Value:   value,
		})
	}

	return nil
}

func (p *ResultParser) parseEnergyCap(results *ParsedResults) error {
	file, err := os.Open(filepath.Join(p.resultsDir, "results_energy_cap.csv"))
	if err != nil {
		return err
	}
	defer file.Close()

	reader := csv.NewReader(file)
	_, _ = reader.Read() // Skip header

	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if len(row) < 3 {
			continue
		}

		techParts := strings.SplitN(row[1], ":", 2)
		tech := techParts[0]
		toLoc := ""
		if len(techParts) > 1 {
			toLoc = techParts[1]
		}

		value, err := parseCSVFloat(row[2])
		if err != nil {
			continue
		}
		results.EnergyCap = append(results.EnergyCap, EnergyCap{
			Location: row[0],
			Tech:     tech,
			ToLoc:    toLoc,
			Value:    value,
		})
	}

	return nil
}

func (p *ResultParser) parseCost(results *ParsedResults) error {
	file, err := os.Open(filepath.Join(p.resultsDir, "results_cost.csv"))
	if err != nil {
		return err
	}
	defer file.Close()

	reader := csv.NewReader(file)
	header, err := reader.Read()
	if err != nil {
		return err
	}

	idx := findCostColumnIndices(header)

	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}

		value, ok := safeParseFloat(row, idx.value)
		if !ok {
			continue
		}

		record := CostRecord{
			Costs: safeGetString(row, idx.costs),
			Techs: safeGetString(row, idx.techs),
			Value: value,
		}
		record.FromLocation, record.ToLocation = parseLocationParts(safeGetString(row, idx.locs))

		results.Cost = append(results.Cost, record)
	}

	return nil
}

type costColumnIndices struct {
	costs, locs, techs, value, timesteps int
}

func findCostColumnIndices(header []string) costColumnIndices {
	idx := costColumnIndices{-1, -1, -1, -1, -1}
	for i, h := range header {
		switch strings.ToLower(h) {
		case "costs":
			idx.costs = i
		case "locs":
			idx.locs = i
		case "techs":
			idx.techs = i
		case "value", "cost":
			idx.value = i
		case "timesteps":
			idx.timesteps = i
		}
	}
	return idx
}

func findCostVarColumnIndices(header []string) costColumnIndices {
	idx := costColumnIndices{-1, -1, -1, -1, -1}
	for i, h := range header {
		switch strings.ToLower(h) {
		case "costs":
			idx.costs = i
		case "locs":
			idx.locs = i
		case "techs":
			idx.techs = i
		case "timesteps":
			idx.timesteps = i
		case "value", "cost_var":
			idx.value = i
		}
	}
	return idx
}

func parseCSVToMap(filepath string) (map[string]string, error) {
	file, err := os.Open(filepath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	reader := csv.NewReader(file)
	_, _ = reader.Read() // Skip header

	result := make(map[string]string)
	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}
		if len(row) >= 2 {
			result[row[0]] = row[1]
		}
	}
	return result, nil
}

func checkConvergenceFromCSV(filepath string) (bool, error) {
	file, err := os.Open(filepath)
	if err != nil {
		return false, err
	}
	defer file.Close()

	reader := csv.NewReader(file)
	_, _ = reader.Read() // Skip header

	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return false, err
		}
		for _, col := range row {
			if strings.ToLower(col) == "false" {
				return false, nil
			}
		}
	}
	return true, nil
}

func (p *ResultParser) parsePyPSA() (*PyPSAResults, error) {
	pypsa := &PyPSAResults{}

	settings, err := parseCSVToMap(filepath.Join(p.pypsaDir, "settings.csv"))
	if err != nil {
		return nil, err
	}

	pypsa.VoltLV = settings["v_nom_lv"]
	pypsa.VoltMV = settings["v_nom_mv"]
	pypsa.TrafoTypeMVLV = settings["trafo_type_mv_lv"]
	pypsa.LineTypeLV = settings["line_type_lv"]
	pypsa.LineTypeMV = settings["line_type_mv"]

	pypsa.Converged, err = checkConvergenceFromCSV(filepath.Join(p.pypsaDir, "pf_result.csv"))
	if err != nil {
		return nil, err
	}

	return pypsa, nil
}

type genInfo struct {
	name     string
	location string
	tech     string
}

type busInfo struct {
	name     string
	location string
}

func parseBusHeader(header []string) []busInfo {
	buses := []busInfo{}
	for i, col := range header {
		if i == 0 || col == "" || col == "timesteps" {
			continue
		}
		loc := strings.TrimPrefix(col, "bus_")
		loc = strings.TrimSuffix(loc, "_lv")
		loc = strings.TrimSuffix(loc, "_mv")
		loc = strings.TrimPrefix(loc, "ID_")
		buses = append(buses, busInfo{name: col, location: loc})
	}
	return buses
}

func parseTimestampFromRow(row []string) (time.Time, bool) {
	if len(row) == 0 {
		return time.Time{}, false
	}
	ts, err := time.Parse(dateFormatSpace, row[0])
	if err != nil {
		ts, err = time.Parse(dateFormatT, row[0])
		if err != nil {
			return time.Time{}, false
		}
	}
	return ts, true
}

func openPyPSAPowerFile(csvWebDir, csvDir string) (*os.File, float64, error) {
	webFile := filepath.Join(csvWebDir, "buses-p-t.csv")
	f, err := os.Open(webFile)
	if err == nil {
		return f, 0.001, nil // W -> kW
	}

	rawFile := filepath.Join(csvDir, "buses-p.csv")
	f, err = os.Open(rawFile)
	if err == nil {
		return f, 1000, nil // MW -> kW
	}

	return nil, 0, err
}

func openPyPSAFile(csvWebDir, csvDir, filename string) (*os.File, error) {
	f, err := os.Open(filepath.Join(csvWebDir, filename))
	if err != nil {
		f, err = os.Open(filepath.Join(csvDir, filename))
	}
	return f, err
}

func parseBusValueRow(row []string, buses []busInfo, ts time.Time, handler func(bus busInfo, val float64)) int {
	count := 0
	for i, valStr := range row {
		if i == 0 || i-1 >= len(buses) {
			continue
		}
		val, err := parseCSVFloat(valStr)
		if err != nil {
			continue
		}
		handler(buses[i-1], val)
		count++
	}
	return count
}

// converts parsed results to JSON bytes
func (r *ParsedResults) ToJSON() ([]byte, error) {
	return json.Marshal(r)
}

func (p *ResultParser) parseCostInvestment(results *ParsedResults) error {
	filePath := filepath.Join(p.resultsDir, "results_cost_investment.csv")
	columns := []string{"costs", "locs", "techs", "cost_investment"}

	return readCSVWithColumns(filePath, columns, func(row []string, idx []int) error {
		val, ok := safeParseFloat(row, idx[3])
		if !ok {
			return nil
		}

		results.CostInvestment = append(results.CostInvestment, CostInvestmentRecord{
			Costs:    safeGetString(row, idx[0]),
			Location: safeGetString(row, idx[1]),
			Tech:     safeGetString(row, idx[2]),
			Value:    val,
		})
		return nil
	})
}

func parseTimestampSimple(s string) (time.Time, bool) {
	return parseTimestamp(s)
}
