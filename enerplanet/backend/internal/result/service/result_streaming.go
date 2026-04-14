package resultservice

import (
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"math"
	"os"
	"path/filepath"
	"strings"
	"time"

	"gorm.io/gorm"

	"platform.local/platform/logger"
	"spatialhub_backend/internal/models"
)

// StreamingInserter reads large CSV files row-by-row and inserts into the DB
// in batches, avoiding loading entire time-series into memory.
type StreamingInserter struct {
	ctx       context.Context
	db        *gorm.DB
	modelID   uint
	batchSize int
	scale     float64 // power normalization scale (1 or 1000)

	SumProduction  float64 // accumulated during StreamCarrierProd
	SumConsumption float64 // accumulated during StreamCarrierCon
}

func NewStreamingInserter(ctx context.Context, db *gorm.DB, modelID uint, scale float64) *StreamingInserter {
	return &StreamingInserter{
		ctx:       ctx,
		db:        db,
		modelID:   modelID,
		batchSize: 500,
		scale:     scale,
	}
}

// StreamAll orchestrates streaming of all large data types from CSV to DB.
func (s *StreamingInserter) StreamAll(resultsDir, pypsaDir string, hasPypsa bool) error {
	log := logger.ForComponent("result_streaming")

	type streamStep struct {
		name     string
		fn       func() error
		optional bool
	}

	steps := []streamStep{
		{"capacity_factor", func() error { return s.StreamCapacityFactor(resultsDir) }, false},
		{"carrier_prod", func() error { return s.StreamCarrierProd(resultsDir) }, false},
		{"carrier_con", func() error { return s.StreamCarrierCon(resultsDir) }, false},
		{"cost_var", func() error { return s.StreamCostVar(resultsDir) }, false},
		{"system_balance", func() error { return s.StreamSystemBalance(resultsDir) }, false},
		{"unmet_demand", func() error { return s.StreamUnmetDemand(resultsDir) }, false},
		{"resource_con", func() error { return s.StreamResourceCon(resultsDir) }, false},
	}

	if hasPypsa && pypsaDir != "" {
		steps = append(steps,
			streamStep{"pypsa_voltage", func() error { return s.StreamPyPSAVoltage(pypsaDir) }, true},
			streamStep{"pypsa_power", func() error { return s.StreamPyPSAPower(pypsaDir) }, true},
			streamStep{"pypsa_line_loading", func() error { return s.StreamPyPSALineLoading(pypsaDir) }, true},
			streamStep{"line_flows", func() error { return s.StreamLineFlows(pypsaDir) }, true},
			streamStep{"transformer_flows", func() error { return s.StreamTransformerFlows(pypsaDir) }, true},
		)
	}

	for _, step := range steps {
		if err := s.ctx.Err(); err != nil {
			return fmt.Errorf("streaming cancelled: %w", err)
		}
		if err := step.fn(); err != nil {
			if os.IsNotExist(err) {
				log.Debugf("Streaming %s: file not found, skipping", step.name)
				continue
			}
			if step.optional {
				log.Warnf("Streaming %s failed (non-fatal, will read from files): %v", step.name, err)
				continue
			}
			log.Errorf("Streaming %s failed: %v", step.name, err)
			return fmt.Errorf("streaming %s failed: %w", step.name, err)
		}
		log.Debugf("Streamed %s for model_id=%d", step.name, s.modelID)
	}

	return nil
}

func (s *StreamingInserter) flushBatch(batch interface{}, name string) error {
	if err := s.ctx.Err(); err != nil {
		return fmt.Errorf("streaming %s cancelled: %w", name, err)
	}
	if err := s.db.CreateInBatches(batch, s.batchSize).Error; err != nil {
		return fmt.Errorf("failed to insert %s batch: %w", name, err)
	}
	return nil
}

// StreamCapacityFactor streams results_capacity_factor.csv into the DB.
func (s *StreamingInserter) StreamCapacityFactor(resultsDir string) error {
	filePath := filepath.Join(resultsDir, "results_capacity_factor.csv")
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

	idx := findColumnIndices(header, "capacity_factor")

	batch := make([]models.ResultsCapacityFactor, 0, s.batchSize)

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

		fromLoc, toLoc := parseLocationParts(safeGetString(row, idx.locs))

		record := models.ResultsCapacityFactor{
			ModelID:      s.modelID,
			FromLocation: fromLoc,
			Carrier:      safeGetString(row, idx.carrier),
			Techs:        safeGetString(row, idx.techs),
			Value:        value,
		}
		if toLoc != "" {
			record.ToLocation = &toLoc
		}
		if ts, ok := parseTimestamp(safeGetString(row, idx.timesteps)); ok {
			record.Timestep = &ts
		}

		batch = append(batch, record)
		if len(batch) >= s.batchSize {
			if err := s.flushBatch(&batch, "capacity_factor"); err != nil {
				return err
			}
			batch = batch[:0]
		}
	}

	if len(batch) > 0 {
		return s.flushBatch(&batch, "capacity_factor")
	}
	return nil
}

// StreamCarrierProd streams results_carrier_prod.csv and accumulates SumProduction.
func (s *StreamingInserter) StreamCarrierProd(resultsDir string) error {
	filePath := filepath.Join(resultsDir, fileResultsCarrierProd)
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

	idx := findColumnIndices(header, "carrier_prod")

	batch := make([]models.ResultsCarrierProd, 0, s.batchSize)

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

		carrier := safeGetString(row, idx.carrier)
		techs := safeGetString(row, idx.techs)

		ts, hasTimestamp := parseTimestamp(safeGetString(row, idx.timesteps))
		if !hasTimestamp {
			continue
		}

		// Apply power scale
		if carrier == "power" && s.scale != 1 {
			value *= s.scale
		}

		// Accumulate sum production
		if carrier == "power" {
			tech := techBase(techs)
			if tech != "power_transmission" {
				s.SumProduction += math.Abs(value)
			}
		}

		fromLoc, toLoc := parseLocationParts(safeGetString(row, idx.locs))

		record := models.ResultsCarrierProd{
			ModelID:      s.modelID,
			FromLocation: fromLoc,
			Carrier:      carrier,
			Techs:        techs,
			Timestep:     ts,
			Value:        value,
		}
		if toLoc != "" {
			record.ToLocation = &toLoc
		}

		batch = append(batch, record)
		if len(batch) >= s.batchSize {
			if err := s.flushBatch(&batch, "carrier_prod"); err != nil {
				return err
			}
			batch = batch[:0]
		}
	}

	if len(batch) > 0 {
		return s.flushBatch(&batch, "carrier_prod")
	}
	return nil
}

// StreamCarrierCon streams results_carrier_con.csv and accumulates SumConsumption.
func (s *StreamingInserter) StreamCarrierCon(resultsDir string) error {
	filePath := filepath.Join(resultsDir, fileResultsCarrierCon)
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

	idx := findColumnIndices(header, "carrier_con")

	batch := make([]models.ResultsCarrierCon, 0, s.batchSize)

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

		carrier := safeGetString(row, idx.carrier)
		techs := safeGetString(row, idx.techs)

		ts, hasTimestamp := parseTimestamp(safeGetString(row, idx.timesteps))
		if !hasTimestamp {
			continue
		}

		// Apply power scale
		if carrier == "power" && s.scale != 1 {
			value *= s.scale
		}

		// Accumulate sum consumption
		if carrier == "power" && isDemandTech(techs) {
			s.SumConsumption += math.Abs(value)
		}

		fromLoc, toLoc := parseLocationParts(safeGetString(row, idx.locs))

		record := models.ResultsCarrierCon{
			ModelID:      s.modelID,
			FromLocation: fromLoc,
			Carrier:      carrier,
			Techs:        techs,
			Timestep:     ts,
			Value:        value,
		}
		if toLoc != "" {
			record.ToLocation = &toLoc
		}

		batch = append(batch, record)
		if len(batch) >= s.batchSize {
			if err := s.flushBatch(&batch, "carrier_con"); err != nil {
				return err
			}
			batch = batch[:0]
		}
	}

	if len(batch) > 0 {
		return s.flushBatch(&batch, "carrier_con")
	}
	return nil
}

// StreamCostVar streams results_cost_var.csv into the DB.
func (s *StreamingInserter) StreamCostVar(resultsDir string) error {
	filePath := filepath.Join(resultsDir, "results_cost_var.csv")
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

	idx := findCostVarColumnIndices(header)

	batch := make([]models.ResultsCostVar, 0, s.batchSize)

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

		ts, hasTimestamp := parseTimestamp(safeGetString(row, idx.timesteps))
		if !hasTimestamp {
			continue
		}

		record := models.ResultsCostVar{
			ModelID:  s.modelID,
			Location: safeGetString(row, idx.locs),
			Costs:    safeGetString(row, idx.costs),
			Techs:    safeGetString(row, idx.techs),
			Timestep: ts,
			Value:    value,
		}

		batch = append(batch, record)
		if len(batch) >= s.batchSize {
			if err := s.flushBatch(&batch, "cost_var"); err != nil {
				return err
			}
			batch = batch[:0]
		}
	}

	if len(batch) > 0 {
		return s.flushBatch(&batch, "cost_var")
	}
	return nil
}

// StreamSystemBalance streams results_system_balance.csv into the DB.
func (s *StreamingInserter) StreamSystemBalance(resultsDir string) error {
	filePath := filepath.Join(resultsDir, "results_system_balance.csv")
	return s.streamSystemBalance(filePath, []string{"carriers", "locs", "timesteps", "system_balance"},
		func(row []string, colIdx []int, batch *[]models.ResultsSystemBalance) error {
			val, ok := safeParseFloat(row, colIdx[3])
			if !ok {
				return nil
			}
			ts, hasTimestamp := parseTimestampSimple(safeGetString(row, colIdx[2]))
			if !hasTimestamp {
				return nil
			}

			carrier := safeGetString(row, colIdx[0])
			// Apply power scale to system balance
			if carrier == "power" && s.scale != 1 {
				val *= s.scale
			}

			*batch = append(*batch, models.ResultsSystemBalance{
				ModelID:  s.modelID,
				Carrier:  carrier,
				Location: safeGetString(row, colIdx[1]),
				Timestep: ts,
				Value:    val,
			})
			return nil
		}, "system_balance")
}

// StreamUnmetDemand streams results_unmet_demand.csv into the DB.
func (s *StreamingInserter) StreamUnmetDemand(resultsDir string) error {
	filePath := filepath.Join(resultsDir, "results_unmet_demand.csv")
	return s.streamUnmetDemand(filePath, []string{"carriers", "locs", "timesteps", "unmet_demand"},
		func(row []string, colIdx []int, batch *[]models.ResultsUnmetDemand) error {
			val, ok := safeParseFloat(row, colIdx[3])
			if !ok {
				return nil
			}
			ts, hasTimestamp := parseTimestampSimple(safeGetString(row, colIdx[2]))
			if !hasTimestamp {
				return nil
			}

			carrier := safeGetString(row, colIdx[0])
			// Apply power scale to unmet demand
			if carrier == "power" && s.scale != 1 {
				val *= s.scale
			}

			*batch = append(*batch, models.ResultsUnmetDemand{
				ModelID:  s.modelID,
				Carrier:  carrier,
				Location: safeGetString(row, colIdx[1]),
				Timestep: ts,
				Value:    val,
			})
			return nil
		}, "unmet_demand")
}

// StreamResourceCon streams results_resource_con.csv into the DB.
func (s *StreamingInserter) StreamResourceCon(resultsDir string) error {
	filePath := filepath.Join(resultsDir, "results_resource_con.csv")
	return s.streamResourceCon(filePath, []string{"locs", "techs", "timesteps", "resource_con"},
		func(row []string, colIdx []int, batch *[]models.ResultsResourceCon) error {
			val, ok := safeParseFloat(row, colIdx[3])
			if !ok {
				return nil
			}
			ts, hasTimestamp := parseTimestampSimple(safeGetString(row, colIdx[2]))
			if !hasTimestamp {
				return nil
			}

			*batch = append(*batch, models.ResultsResourceCon{
				ModelID:  s.modelID,
				Location: safeGetString(row, colIdx[0]),
				Tech:     safeGetString(row, colIdx[1]),
				Timestep: ts,
				Value:    val,
			})
			return nil
		}, "resource_con")
}

// streamWithColumns is a generic helper for streaming CSV files that use
// the readCSVWithColumns column-lookup pattern.
func streamWithColumns[T any](s *StreamingInserter, filePath string, columns []string, process func(row []string, colIdx []int, batch *[]T) error, name string) error {
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

	colIdx := make([]int, len(columns))
	for i, col := range columns {
		colIdx[i] = -1
		target := strings.ToLower(strings.TrimSpace(col))
		for j, h := range normalizedHeader {
			if h == target {
				colIdx[i] = j
				break
			}
		}
		if colIdx[i] == -1 {
			return fmt.Errorf("missing required column %s in %s", col, filepath.Base(filePath))
		}
	}

	batch := make([]T, 0, s.batchSize)

	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}

		if err := process(row, colIdx, &batch); err != nil {
			return err
		}

		if len(batch) >= s.batchSize {
			if err := s.ctx.Err(); err != nil {
				return fmt.Errorf("streaming %s cancelled: %w", name, err)
			}
			if err := s.db.CreateInBatches(&batch, s.batchSize).Error; err != nil {
				return fmt.Errorf("failed to insert %s batch: %w", name, err)
			}
			batch = batch[:0]
		}
	}

	if len(batch) > 0 {
		if err := s.db.CreateInBatches(&batch, s.batchSize).Error; err != nil {
			return fmt.Errorf("failed to insert %s batch: %w", name, err)
		}
	}
	return nil
}

// Typed wrappers for streamWithColumns (Go generics require function-level type params)
func (s *StreamingInserter) streamSystemBalance(filePath string, columns []string, process func(row []string, colIdx []int, batch *[]models.ResultsSystemBalance) error, name string) error {
	return streamWithColumns(s, filePath, columns, process, name)
}
func (s *StreamingInserter) streamUnmetDemand(filePath string, columns []string, process func(row []string, colIdx []int, batch *[]models.ResultsUnmetDemand) error, name string) error {
	return streamWithColumns(s, filePath, columns, process, name)
}
func (s *StreamingInserter) streamResourceCon(filePath string, columns []string, process func(row []string, colIdx []int, batch *[]models.ResultsResourceCon) error, name string) error {
	return streamWithColumns(s, filePath, columns, process, name)
}

// StreamPyPSAVoltage streams buses-v_mag_pu CSV into the DB.
func (s *StreamingInserter) StreamPyPSAVoltage(pypsaDir string) error {
	csvDir, err := findCSVSimDir(pypsaDir)
	if err != nil {
		return err
	}

	csvWebDir := filepath.Join(csvDir, "csv_web")

	vFile, err := openPyPSAFile(csvWebDir, csvDir, "buses-v_mag_pu-t.csv")
	if err != nil {
		vFile, err = openPyPSAFile(csvWebDir, csvDir, "buses-v_mag_pu.csv")
		if err != nil {
			return err
		}
	}
	defer vFile.Close()

	reader := csv.NewReader(vFile)
	header, err := reader.Read()
	if err != nil {
		return err
	}

	buses := parseBusHeader(header)
	batch := make([]models.ResultsPyPSAVoltage, 0, s.batchSize)

	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if len(row) == 0 {
			continue
		}

		ts, ok := parseTimestampFromRow(row)
		if !ok {
			continue
		}

		parseBusValueRow(row, buses, ts, func(bus busInfo, val float64) {
			batch = append(batch, models.ResultsPyPSAVoltage{
				ModelID:  s.modelID,
				Bus:      bus.name,
				Location: bus.location,
				Timestep: ts,
				VMagPu:   val,
			})
		})

		if len(batch) >= s.batchSize {
			if err := s.flushBatch(&batch, "pypsa_voltage"); err != nil {
				return err
			}
			batch = batch[:0]
		}
	}

	if len(batch) > 0 {
		return s.flushBatch(&batch, "pypsa_voltage")
	}
	return nil
}

// StreamPyPSAPower streams buses-p CSV into the DB with power scaling.
func (s *StreamingInserter) StreamPyPSAPower(pypsaDir string) error {
	csvDir, err := findCSVSimDir(pypsaDir)
	if err != nil {
		return err
	}

	csvWebDir := filepath.Join(csvDir, "csv_web")

	pFile, powerScale, err := openPyPSAPowerFile(csvWebDir, csvDir)
	if err != nil {
		return err
	}
	defer pFile.Close()

	reader := csv.NewReader(pFile)
	header, err := reader.Read()
	if err != nil {
		return err
	}

	buses := parseBusHeader(header)
	batch := make([]models.ResultsPyPSAPower, 0, s.batchSize)

	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return err
		}
		if len(row) == 0 {
			continue
		}

		ts, ok := parseTimestampFromRow(row)
		if !ok {
			continue
		}

		parseBusValueRow(row, buses, ts, func(bus busInfo, val float64) {
			batch = append(batch, models.ResultsPyPSAPower{
				ModelID:  s.modelID,
				Bus:      bus.name,
				Location: bus.location,
				Timestep: ts,
				P:        val * powerScale,
			})
		})

		if len(batch) >= s.batchSize {
			if err := s.flushBatch(&batch, "pypsa_power"); err != nil {
				return err
			}
			batch = batch[:0]
		}
	}

	if len(batch) > 0 {
		return s.flushBatch(&batch, "pypsa_power")
	}
	return nil
}

type lineEndpoints struct {
	bus0 string
	bus1 string
}

func loadLineEndpoints(csvDir string) (map[string]lineEndpoints, error) {
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

	nameIdx, bus0Idx, bus1Idx := -1, -1, -1
	for i, col := range header {
		switch strings.ToLower(strings.TrimSpace(col)) {
		case "name":
			nameIdx = i
		case "bus0":
			bus0Idx = i
		case "bus1":
			bus1Idx = i
		}
	}
	if nameIdx == -1 || bus0Idx == -1 || bus1Idx == -1 {
		return nil, fmt.Errorf("lines.csv missing required columns")
	}

	endpoints := make(map[string]lineEndpoints)
	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			return nil, err
		}

		name := safeGetString(row, nameIdx)
		if name == "" {
			continue
		}
		endpoints[name] = lineEndpoints{
			bus0: safeGetString(row, bus0Idx),
			bus1: safeGetString(row, bus1Idx),
		}
	}

	return endpoints, nil
}

func openOptionalCSVReader(path string) (*csv.Reader, *os.File, error) {
	file, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil, nil
		}
		return nil, nil, err
	}

	reader := csv.NewReader(file)
	if _, err := reader.Read(); err != nil {
		file.Close()
		return nil, nil, err
	}

	return reader, file, nil
}

func readOptionalCSVRow(reader *csv.Reader) ([]string, error) {
	if reader == nil {
		return nil, nil
	}
	row, err := reader.Read()
	if err == io.EOF {
		return nil, io.EOF
	}
	return row, err
}

func streamP0P1Flows[T any](
	s *StreamingInserter, pypsaDir, p0Filename, p1Filename, batchKey string,
	createRecord func(modelID uint, name string, p0, p1 float64, ts time.Time) T,
) error {
	csvDir, err := findCSVSimDir(pypsaDir)
	if err != nil {
		return err
	}

	timestamps, err := parseSnapshotsCSV(csvDir)
	if err != nil {
		return err
	}

	p0File, err := os.Open(filepath.Join(csvDir, p0Filename))
	if err != nil {
		return err
	}
	defer p0File.Close()

	p1File, err := os.Open(filepath.Join(csvDir, p1Filename))
	if err != nil {
		return err
	}
	defer p1File.Close()

	p0Reader := csv.NewReader(p0File)
	p1Reader := csv.NewReader(p1File)

	p0Header, err := p0Reader.Read()
	if err != nil {
		return err
	}
	if _, err := p1Reader.Read(); err != nil {
		return err
	}

	names := p0Header[1:]
	batch := make([]T, 0, s.batchSize)
	rowIdx := 0

	for {
		p0Row, p0Err := p0Reader.Read()
		p1Row, p1Err := p1Reader.Read()

		if p0Err == io.EOF || p1Err == io.EOF {
			break
		}
		if p0Err != nil {
			return p0Err
		}
		if p1Err != nil {
			return p1Err
		}

		for i, name := range names {
			var p0Val, p1Val float64
			if i+1 < len(p0Row) {
				if v, err := parseCSVFloat(p0Row[i+1]); err == nil {
					p0Val = v * 1000 // MW -> kW
				}
			}
			if i+1 < len(p1Row) {
				if v, err := parseCSVFloat(p1Row[i+1]); err == nil {
					p1Val = v * 1000 // MW -> kW
				}
			}

			var ts time.Time
			if rowIdx < len(timestamps) {
				ts = timestamps[rowIdx]
			}

			record := createRecord(s.modelID, name, p0Val, p1Val, ts)

			batch = append(batch, record)
			if len(batch) >= s.batchSize {
				if err := s.flushBatch(&batch, batchKey); err != nil {
					return err
				}
				batch = batch[:0]
			}
		}
		rowIdx++
	}

	if len(batch) > 0 {
		return s.flushBatch(&batch, batchKey)
	}
	return nil
}

// StreamLineFlows streams lines-p0 and lines-p1 CSV files in lockstep.
func (s *StreamingInserter) StreamLineFlows(pypsaDir string) error {
	return streamP0P1Flows(s, pypsaDir, "lines-p0.csv", "lines-p1.csv", "line_flows",
		func(modelID uint, name string, p0, p1 float64, ts time.Time) models.ResultsLineFlow {
			record := models.ResultsLineFlow{
				ModelID: modelID,
				Line:    name,
				P0:      p0,
				P1:      p1,
			}
			if !ts.IsZero() {
				record.Timestep = ts
			}
			return record
		})
}

// StreamPyPSALineLoading streams detailed PyPSA line results into results_pypsa_line_loading.
func (s *StreamingInserter) StreamPyPSALineLoading(pypsaDir string) error {
	csvDir, err := findCSVSimDir(pypsaDir)
	if err != nil {
		return err
	}

	timestamps, err := parseSnapshotsCSV(csvDir)
	if err != nil {
		return err
	}

	endpoints, err := loadLineEndpoints(csvDir)
	if err != nil {
		return err
	}

	p0File, err := os.Open(filepath.Join(csvDir, "lines-p0.csv"))
	if err != nil {
		return err
	}
	defer p0File.Close()

	p1File, err := os.Open(filepath.Join(csvDir, "lines-p1.csv"))
	if err != nil {
		return err
	}
	defer p1File.Close()

	p0Reader := csv.NewReader(p0File)
	p1Reader := csv.NewReader(p1File)

	p0Header, err := p0Reader.Read()
	if err != nil {
		return err
	}
	if _, err := p1Reader.Read(); err != nil {
		return err
	}

	q0Reader, q0File, err := openOptionalCSVReader(filepath.Join(csvDir, "lines-q0.csv"))
	if err != nil {
		return err
	}
	if q0File != nil {
		defer q0File.Close()
	}

	q1Reader, q1File, err := openOptionalCSVReader(filepath.Join(csvDir, "lines-q1.csv"))
	if err != nil {
		return err
	}
	if q1File != nil {
		defer q1File.Close()
	}

	lines := p0Header[1:]
	batch := make([]models.ResultsPyPSALineLoading, 0, s.batchSize)
	rowIdx := 0

	for {
		p0Row, p0Err := p0Reader.Read()
		p1Row, p1Err := p1Reader.Read()
		q0Row, q0Err := readOptionalCSVRow(q0Reader)
		q1Row, q1Err := readOptionalCSVRow(q1Reader)

		if p0Err == io.EOF || p1Err == io.EOF {
			break
		}
		if p0Err != nil {
			return p0Err
		}
		if p1Err != nil {
			return p1Err
		}
		if q0Err != nil {
			return q0Err
		}
		if q1Err != nil {
			return q1Err
		}

		for i, line := range lines {
			endpoint, ok := endpoints[line]
			if !ok {
				return fmt.Errorf("missing line metadata for %s", line)
			}

			var p0Val float64
			if i+1 < len(p0Row) {
				if v, err := parseCSVFloat(p0Row[i+1]); err == nil {
					p0Val = v * 1000 // MW -> kW
				}
			}

			var p1Ptr *float64
			if i+1 < len(p1Row) {
				if v, err := parseCSVFloat(p1Row[i+1]); err == nil {
					p1Val := v * 1000 // MW -> kW
					p1Ptr = &p1Val
				}
			}

			var q0Ptr *float64
			if q0Row != nil && i+1 < len(q0Row) {
				if v, err := parseCSVFloat(q0Row[i+1]); err == nil {
					q0Val := v * 1000 // MVAr -> kVAr
					q0Ptr = &q0Val
				}
			}

			var q1Ptr *float64
			if q1Row != nil && i+1 < len(q1Row) {
				if v, err := parseCSVFloat(q1Row[i+1]); err == nil {
					q1Val := v * 1000 // MVAr -> kVAr
					q1Ptr = &q1Val
				}
			}

			record := models.ResultsPyPSALineLoading{
				ModelID: s.modelID,
				Line:    line,
				Bus0:    endpoint.bus0,
				Bus1:    endpoint.bus1,
				P0:      p0Val,
				P1:      p1Ptr,
				Q0:      q0Ptr,
				Q1:      q1Ptr,
			}
			if rowIdx < len(timestamps) {
				record.Timestep = timestamps[rowIdx]
			}

			batch = append(batch, record)
			if len(batch) >= s.batchSize {
				if err := s.flushBatch(&batch, "pypsa_line_loading"); err != nil {
					return err
				}
				batch = batch[:0]
			}
		}
		rowIdx++
	}

	if len(batch) > 0 {
		return s.flushBatch(&batch, "pypsa_line_loading")
	}
	return nil
}

// StreamTransformerFlows streams transformers-p0 and transformers-p1 CSV files in lockstep.
func (s *StreamingInserter) StreamTransformerFlows(pypsaDir string) error {
	csvDir, err := findCSVSimDir(pypsaDir)
	if err != nil {
		return err
	}

	timestamps, err := parseSnapshotsCSV(csvDir)
	if err != nil {
		return err
	}

	p0File, err := os.Open(filepath.Join(csvDir, "transformers-p0.csv"))
	if err != nil {
		return err
	}
	defer p0File.Close()

	p1File, err := os.Open(filepath.Join(csvDir, "transformers-p1.csv"))
	if err != nil {
		return err
	}
	defer p1File.Close()

	p0Reader := csv.NewReader(p0File)
	p1Reader := csv.NewReader(p1File)

	p0Header, err := p0Reader.Read()
	if err != nil {
		return err
	}
	if _, err := p1Reader.Read(); err != nil {
		return err
	}

	trafos := p0Header[1:]
	batch := make([]models.ResultsTransformerFlow, 0, s.batchSize)
	rowIdx := 0

	for {
		p0Row, p0Err := p0Reader.Read()
		p1Row, p1Err := p1Reader.Read()

		if p0Err == io.EOF || p1Err == io.EOF {
			break
		}
		if p0Err != nil {
			return p0Err
		}
		if p1Err != nil {
			return p1Err
		}

		for i, trafo := range trafos {
			var p0Val, p1Val float64
			if i+1 < len(p0Row) {
				if v, err := parseCSVFloat(p0Row[i+1]); err == nil {
					p0Val = v * 1000 // MW -> kW
				}
			}
			if i+1 < len(p1Row) {
				if v, err := parseCSVFloat(p1Row[i+1]); err == nil {
					p1Val = v * 1000 // MW -> kW
				}
			}

			record := models.ResultsTransformerFlow{
				ModelID:     s.modelID,
				Transformer: trafo,
				P0:          p0Val,
				P1:          p1Val,
			}
			if rowIdx < len(timestamps) {
				record.Timestep = timestamps[rowIdx]
			}

			batch = append(batch, record)
			if len(batch) >= s.batchSize {
				if err := s.flushBatch(&batch, "transformer_flows"); err != nil {
					return err
				}
				batch = batch[:0]
			}
		}
		rowIdx++
	}

	if len(batch) > 0 {
		return s.flushBatch(&batch, "transformer_flows")
	}
	return nil
}
