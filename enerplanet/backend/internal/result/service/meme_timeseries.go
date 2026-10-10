package resultservice

import (
	"encoding/csv"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"gorm.io/gorm"

	"platform.local/platform/logger"

	"spatialhub_backend/internal/models"
)

// memeStreamBatchSize mirrors StreamingInserter.batchSize so MEME time-series
// inserts batch identically to the legacy CSV streaming path.
const memeStreamBatchSize = 500

// grid techs are named grid_<node>_(import|export) by the MEME emitter.
var (
	memeGridImportRe = regexp.MustCompile(`^grid_.*_import$`)
	memeGridExportRe = regexp.MustCompile(`^grid_.*_export$`)
)

// streamMemeTimeSeries maps the Calliope leg's long-format CSVs (already in the
// R2 shape) into the R2 time-series tables, normalising the MEME emitter's
// technology/carrier vocabulary on write so no consumer (store/frontend) needs
// changing. It writes results_carrier_prod, results_carrier_con,
// results_capacity_factor, results_model_capacity_factor,
// results_model_levelised_cost, results_model_total_levelised_cost and
// results_cost_var. results_system_balance / results_resource_con /
// results_unmet_demand are deliberately left empty (no faithful per-location
// source).
//
// A missing CSV file (or a missing csv dir, e.g. a PyPSA-only bundle) is not an
// error: that table is simply skipped. A malformed row is skipped. POWER series
// (carrier_prod/con) are scaled MW -> kW at write time (the R2 contract is kW);
// ratios, levelised costs and currencies are stored unscaled.
func streamMemeTimeSeries(tx *gorm.DB, modelID uint, csvDir string, parents map[string]string) error {
	log := logger.ForComponent("result")

	if info, err := os.Stat(csvDir); err != nil || !info.IsDir() {
		log.Warnf("MEME time-series: CSV dir %s not found, skipping (PyPSA-only bundle?) model_id=%d", csvDir, modelID)
		return nil
	}

	w := &memeTimeSeriesWriter{tx: tx, modelID: modelID, csvDir: csvDir, parents: parents}

	steps := []struct {
		name string
		fn   func() error
	}{
		{"carrier_prod", w.streamCarrierProd},
		{"carrier_con", w.streamCarrierCon},
		{"capacity_factor", w.streamCapacityFactor},
		{"model_capacity_factor", w.streamModelCapacityFactor},
		{"model_levelised_cost", w.streamModelLevelisedCost},
		{"model_total_levelised_cost", w.streamModelTotalLevelisedCost},
		{"cost_var", w.streamCostVar},
	}
	for _, step := range steps {
		if err := step.fn(); err != nil {
			return fmt.Errorf("stream MEME %s: %w", step.name, err)
		}
	}
	return nil
}

type memeTimeSeriesWriter struct {
	tx      *gorm.DB
	modelID uint
	csvDir  string
	parents map[string]string
}

// normMemeCarrier maps the MEME carrier vocabulary to the store/frontend default.
func normMemeCarrier(carrier string) string {
	if strings.EqualFold(strings.TrimSpace(carrier), "electricity") {
		return "power"
	}
	return carrier
}

// memeTechClass is the shared classification of a MEME technology against the
// legacy vocabulary. Both the time-series normaliser (normMemeTech) and the
// energy-cap/loc-tech builder (mapCoatiDocument) derive from this ONE source of
// rules, so a MEME technology is rewritten identically everywhere.
type memeTechClass int

const (
	memeTechOther memeTechClass = iota
	memeTechGridImport
	memeTechGridExport
	memeTechTransmission
	memeTechDemand
)

// classifyMemeTech applies the shared naming rules. parents maps a technology
// to its Coati tech_metadata parent (supply | demand | conversion | storage |
// transmission).
func classifyMemeTech(tech string, parents map[string]string) memeTechClass {
	if memeGridExportRe.MatchString(tech) {
		return memeTechGridExport
	}
	if memeGridImportRe.MatchString(tech) {
		return memeTechGridImport
	}
	switch parents[tech] {
	case "transmission":
		return memeTechTransmission
	case "demand":
		return memeTechDemand
	}
	return memeTechOther
}

// normMemeTech rewrites a MEME technology name into the legacy vocabulary. It
// is the time-series vocabulary (carrier_prod/con, capacity_factor, cost_var),
// where a wire is named "power_transmission:<tech>". keep is false for grid
// export rows, which the caller omits from carrier_prod (an offtake, not
// generation).
func normMemeTech(tech, node string, parents map[string]string) (string, bool) {
	switch classifyMemeTech(tech, parents) {
	case memeTechGridExport:
		return tech, false
	case memeTechGridImport:
		return "transformer_supply", true
	case memeTechTransmission:
		return "power_transmission:" + tech, true
	case memeTechDemand:
		if node != "" {
			return node + "_demand", true
		}
	}
	return tech, true
}

// readMemeCSV opens csvDir/filename and calls process for each data row with the
// header's lower-cased column-name index. A missing file is a silent skip; a
// malformed row (bad field count / CSV parse error) is skipped rather than
// aborting the whole table.
func readMemeCSV(csvDir, filename string, process func(cols map[string]int, row []string) error) error {
	file, err := os.Open(filepath.Join(csvDir, filename))
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	defer file.Close()

	reader := csv.NewReader(file)
	reader.FieldsPerRecord = -1 // tolerate ragged rows; skip them below
	header, err := reader.Read()
	if err != nil {
		if err == io.EOF {
			return nil
		}
		return nil // malformed header: treat the table as empty
	}
	cols := make(map[string]int, len(header))
	for i, h := range header {
		cols[strings.ToLower(strings.TrimSpace(h))] = i
	}

	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue // malformed row: skip
		}
		if err := process(cols, row); err != nil {
			return err
		}
	}
	return nil
}

func memeColIdx(cols map[string]int, name string) int {
	if i, ok := cols[name]; ok {
		return i
	}
	return -1
}

func memeString(row []string, cols map[string]int, name string) string {
	return safeGetString(row, memeColIdx(cols, name))
}

func memeFloat(row []string, cols map[string]int, name string) (float64, bool) {
	return safeParseFloat(row, memeColIdx(cols, name))
}

// flushMemeBatch inserts a batch (mirroring StreamingInserter.flushBatch) and
// resets the slice.
func flushMemeBatch[T any](tx *gorm.DB, batch *[]T, table string) error {
	if len(*batch) == 0 {
		return nil
	}
	if err := tx.CreateInBatches(*batch, memeStreamBatchSize).Error; err != nil {
		return fmt.Errorf("insert %s: %w", table, err)
	}
	*batch = (*batch)[:0]
	return nil
}

// results_flow_out.csv -> results_carrier_prod
func (w *memeTimeSeriesWriter) streamCarrierProd() error {
	batch := make([]models.ResultsCarrierProd, 0, memeStreamBatchSize)
	err := readMemeCSV(w.csvDir, "results_flow_out.csv", func(cols map[string]int, row []string) error {
		ts, ok := parseTimestamp(memeString(row, cols, "timesteps"))
		if !ok {
			return nil
		}
		value, ok := memeFloat(row, cols, "flow_out")
		if !ok {
			return nil
		}
		node := memeString(row, cols, "nodes")
		tech, keep := normMemeTech(memeString(row, cols, "techs"), node, w.parents)
		if !keep || node == "" || tech == "" {
			return nil
		}
		batch = append(batch, models.ResultsCarrierProd{
			ModelID:      w.modelID,
			FromLocation: node,
			Carrier:      normMemeCarrier(memeString(row, cols, "carriers")),
			Techs:        tech,
			Timestep:     ts,
			Value:        mwToKw(value),
		})
		if len(batch) >= memeStreamBatchSize {
			return flushMemeBatch(w.tx, &batch, "results_carrier_prod")
		}
		return nil
	})
	if err != nil {
		return err
	}
	return flushMemeBatch(w.tx, &batch, "results_carrier_prod")
}

// results_flow_in.csv -> results_carrier_con
func (w *memeTimeSeriesWriter) streamCarrierCon() error {
	batch := make([]models.ResultsCarrierCon, 0, memeStreamBatchSize)
	err := readMemeCSV(w.csvDir, "results_flow_in.csv", func(cols map[string]int, row []string) error {
		ts, ok := parseTimestamp(memeString(row, cols, "timesteps"))
		if !ok {
			return nil
		}
		value, ok := memeFloat(row, cols, "flow_in")
		if !ok {
			return nil
		}
		node := memeString(row, cols, "nodes")
		tech, _ := normMemeTech(memeString(row, cols, "techs"), node, w.parents)
		if node == "" || tech == "" {
			return nil
		}
		batch = append(batch, models.ResultsCarrierCon{
			ModelID:      w.modelID,
			FromLocation: node,
			Carrier:      normMemeCarrier(memeString(row, cols, "carriers")),
			Techs:        tech,
			Timestep:     ts,
			Value:        mwToKw(value),
		})
		if len(batch) >= memeStreamBatchSize {
			return flushMemeBatch(w.tx, &batch, "results_carrier_con")
		}
		return nil
	})
	if err != nil {
		return err
	}
	return flushMemeBatch(w.tx, &batch, "results_carrier_con")
}

// results_capacity_factor.csv -> results_capacity_factor
func (w *memeTimeSeriesWriter) streamCapacityFactor() error {
	batch := make([]models.ResultsCapacityFactor, 0, memeStreamBatchSize)
	err := readMemeCSV(w.csvDir, "results_capacity_factor.csv", func(cols map[string]int, row []string) error {
		ts, ok := parseTimestamp(memeString(row, cols, "timesteps"))
		if !ok {
			return nil
		}
		value, ok := memeFloat(row, cols, "capacity_factor")
		if !ok {
			return nil
		}
		node := memeString(row, cols, "nodes")
		tech, _ := normMemeTech(memeString(row, cols, "techs"), node, w.parents)
		if node == "" || tech == "" {
			return nil
		}
		t := ts
		batch = append(batch, models.ResultsCapacityFactor{
			ModelID:      w.modelID,
			FromLocation: node,
			Carrier:      normMemeCarrier(memeString(row, cols, "carriers")),
			Techs:        tech,
			Timestep:     &t,
			Value:        value,
		})
		if len(batch) >= memeStreamBatchSize {
			return flushMemeBatch(w.tx, &batch, "results_capacity_factor")
		}
		return nil
	})
	if err != nil {
		return err
	}
	return flushMemeBatch(w.tx, &batch, "results_capacity_factor")
}

// results_systemwide_capacity_factor.csv -> results_model_capacity_factor
func (w *memeTimeSeriesWriter) streamModelCapacityFactor() error {
	batch := make([]models.ResultsModelCapacityFactor, 0, memeStreamBatchSize)
	err := readMemeCSV(w.csvDir, "results_systemwide_capacity_factor.csv", func(cols map[string]int, row []string) error {
		value, ok := memeFloat(row, cols, "systemwide_capacity_factor")
		if !ok {
			return nil
		}
		tech, _ := normMemeTech(memeString(row, cols, "techs"), "", w.parents)
		if tech == "" {
			return nil
		}
		batch = append(batch, models.ResultsModelCapacityFactor{
			ModelID: w.modelID,
			Carrier: normMemeCarrier(memeString(row, cols, "carriers")),
			Techs:   tech,
			Value:   value,
		})
		if len(batch) >= memeStreamBatchSize {
			return flushMemeBatch(w.tx, &batch, "results_model_capacity_factor")
		}
		return nil
	})
	if err != nil {
		return err
	}
	return flushMemeBatch(w.tx, &batch, "results_model_capacity_factor")
}

// results_systemwide_levelised_cost.csv -> results_model_levelised_cost
func (w *memeTimeSeriesWriter) streamModelLevelisedCost() error {
	batch := make([]models.ResultsModelLevelisedCost, 0, memeStreamBatchSize)
	err := readMemeCSV(w.csvDir, "results_systemwide_levelised_cost.csv", func(cols map[string]int, row []string) error {
		value, ok := memeFloat(row, cols, "systemwide_levelised_cost")
		if !ok {
			return nil
		}
		tech, _ := normMemeTech(memeString(row, cols, "techs"), "", w.parents)
		if tech == "" {
			return nil
		}
		batch = append(batch, models.ResultsModelLevelisedCost{
			ModelID: w.modelID,
			Carrier: normMemeCarrier(memeString(row, cols, "carriers")),
			Costs:   memeString(row, cols, "costs"),
			Techs:   tech,
			Value:   value,
		})
		if len(batch) >= memeStreamBatchSize {
			return flushMemeBatch(w.tx, &batch, "results_model_levelised_cost")
		}
		return nil
	})
	if err != nil {
		return err
	}
	return flushMemeBatch(w.tx, &batch, "results_model_levelised_cost")
}

// results_total_levelised_cost.csv -> results_model_total_levelised_cost
func (w *memeTimeSeriesWriter) streamModelTotalLevelisedCost() error {
	batch := make([]models.ResultsModelTotalLevelisedCost, 0, memeStreamBatchSize)
	err := readMemeCSV(w.csvDir, "results_total_levelised_cost.csv", func(cols map[string]int, row []string) error {
		value, ok := memeFloat(row, cols, "total_levelised_cost")
		if !ok {
			return nil
		}
		batch = append(batch, models.ResultsModelTotalLevelisedCost{
			ModelID: w.modelID,
			Carrier: normMemeCarrier(memeString(row, cols, "carriers")),
			Costs:   memeString(row, cols, "costs"),
			Value:   value,
		})
		if len(batch) >= memeStreamBatchSize {
			return flushMemeBatch(w.tx, &batch, "results_model_total_levelised_cost")
		}
		return nil
	})
	if err != nil {
		return err
	}
	return flushMemeBatch(w.tx, &batch, "results_model_total_levelised_cost")
}

// results_cost_operation_variable.csv -> results_cost_var
func (w *memeTimeSeriesWriter) streamCostVar() error {
	batch := make([]models.ResultsCostVar, 0, memeStreamBatchSize)
	err := readMemeCSV(w.csvDir, "results_cost_operation_variable.csv", func(cols map[string]int, row []string) error {
		ts, ok := parseTimestamp(memeString(row, cols, "timesteps"))
		if !ok {
			return nil
		}
		value, ok := memeFloat(row, cols, "cost_operation_variable")
		if !ok {
			return nil
		}
		node := memeString(row, cols, "nodes")
		tech, _ := normMemeTech(memeString(row, cols, "techs"), node, w.parents)
		if node == "" || tech == "" {
			return nil
		}
		batch = append(batch, models.ResultsCostVar{
			ModelID:  w.modelID,
			Location: node,
			Costs:    memeString(row, cols, "costs"),
			Techs:    tech,
			Timestep: ts,
			Value:    value,
		})
		if len(batch) >= memeStreamBatchSize {
			return flushMemeBatch(w.tx, &batch, "results_cost_var")
		}
		return nil
	})
	if err != nil {
		return err
	}
	return flushMemeBatch(w.tx, &batch, "results_cost_var")
}
