package jobs

import (
	"context"
	"encoding/csv"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"

	"github.com/hibiken/asynq"
	"gorm.io/gorm"

	"spatialhub_backend/internal/meme"
	pypsapass "spatialhub_backend/internal/meme/pypsapass"
	"spatialhub_backend/internal/models"
	"spatialhub_backend/internal/payload"
	tentacronclient "spatialhub_backend/internal/tentacron"

	commonModels "platform.local/common/pkg/models"
	"platform.local/platform/logger"
)

// TypeDispatchMemePyPSA is the asynq task type for the isolated PyPSA power-flow
// leg (Step 1B): an optional, derived run that builds a MEME `meme-pypsa` job
// from the parsed Calliope results and dispatches it independently with its own
// leg-keyed run record. It never touches the Calliope leg's dispatch/ingest.
const TypeDispatchMemePyPSA = "dispatch_meme_pypsa"

// DispatchMemePyPSAPayload identifies the model to run the PyPSA leg for. The
// model is loaded fresh so its current config/topology and the Calliope leg's
// stored result are read at dispatch time.
type DispatchMemePyPSAPayload struct {
	ModelID uint   `json:"model_id"`
	UserID  string `json:"user_id"`
}

// CalliopeCSVLocator resolves the stored Calliope bundle's per-target csv dir
// (where results_flow_out.csv / results_flow_in.csv live) for a model. The
// Calliope leg stores its bundle on the filesystem (via ResultZipStore +
// ingest) and the PyPSA pass reads the flow CSVs from it, matching how
// streamMemeTimeSeries locates the csv dir beside the Calliope results.nc. It
// is an interface so the dispatch handler is testable with a temp dir.
type CalliopeCSVLocator interface {
	CalliopeCSVDir(ctx context.Context, modelID uint) (string, error)
}

// dbCalliopeCSVLocator locates the csv dir through the stored model_results
// row (the one the Calliope ingest wrote), walking the extracted bundle for
// the results_flow_out.csv it must contain.
type dbCalliopeCSVLocator struct {
	db *gorm.DB
}

// NewDBCalliopeCSVLocator returns a CalliopeCSVLocator backed by the database.
func NewDBCalliopeCSVLocator(db *gorm.DB) CalliopeCSVLocator {
	return &dbCalliopeCSVLocator{db: db}
}

func (l *dbCalliopeCSVLocator) CalliopeCSVDir(ctx context.Context, modelID uint) (string, error) {
	var row struct {
		ExtractedPath string `gorm:"column:extracted_path"`
	}
	if err := l.db.Raw("SELECT extracted_path FROM model_results WHERE model_id = ? ORDER BY id DESC LIMIT 1", modelID).Scan(&row).Error; err != nil {
		return "", fmt.Errorf("locate calliope result for model %d: %w", modelID, err)
	}
	if row.ExtractedPath == "" {
		return "", fmt.Errorf("locate calliope result for model %d: no extracted calliope bundle recorded", modelID)
	}
	extractDir := row.ExtractedPath

	// The flow CSVs sit in a "csv" dir beside the located Calliope results.nc
	// (resultsFile -> filepath.Dir(resultsFile)/csv), the same layout
	// streamMemeTimeSeries ingests. Walk for results_flow_out.csv and return
	// its parent as the csv dir.
	var csvDir string
	_ = filepath.Walk(extractDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		if info.Name() == "results_flow_out.csv" {
			csvDir = filepath.Dir(path)
		}
		return nil
	})
	if csvDir == "" {
		return "", fmt.Errorf("locate calliope bundle csv dir for model %d: results_flow_out.csv not found under %s", modelID, extractDir)
	}
	return csvDir, nil
}

// pypsaIdempotencyKey scopes a PyPSA submit's Idempotency-Key to the PyPSA leg
// (suffix) AND the solve (startedAt), so it can never collide with the Calliope
// leg's key for the same model and a user re-solve produces a NEW TentaCron job.
func pypsaIdempotencyKey(modelID uint, startedAt *time.Time) string {
	return memeIdempotencyKey(modelID, startedAt) + "_pypsa"
}

// --- p_set reader: Calliope flow CSV -> pypsapass carrier series ------------

// csvColIdx returns the index of a lower-cased header column, or -1.
func csvColIdx(cols map[string]int, name string) int {
	if i, ok := cols[name]; ok {
		return i
	}
	return -1
}

func csvRowAt(row []string, idx int) string {
	if idx < 0 || idx >= len(row) {
		return ""
	}
	return strings.TrimSpace(row[idx])
}

type flowCSVRow struct {
	node, tech, ts string
	val            float64
}

type flowSeries struct {
	node, tech string
	values     []float64
}

// readFlowCSV parses a MEME bundle flow CSV (results_flow_out.csv /
// results_flow_in.csv — columns nodes, techs, timesteps, carriers plus the
// value column flow_out | flow_in) into per (node, tech) pypsapass carrier
// series index-aligned with the model's timesteps. It returns the series and
// the count of distinct timesteps (NumTimesteps for LoadOptions). Node names
// are passed through VERBATIM as FromLocation: the MEME job's nodes are already
// named n<id>, matching the buses the pass derives from the topology node ids.
func readFlowCSV(csvDir, filename, valueCol string) ([]pypsapass.CarrierSeries, int, error) {
	file, err := os.Open(filepath.Join(csvDir, filename))
	if err != nil {
		return nil, 0, err
	}
	defer file.Close()

	reader := csv.NewReader(file)
	reader.FieldsPerRecord = -1 // tolerate ragged rows; skip them below
	header, err := reader.Read()
	if err != nil {
		return nil, 0, err
	}
	cols := make(map[string]int, len(header))
	for i, h := range header {
		cols[strings.ToLower(strings.TrimSpace(h))] = i
	}
	nodeIdx := csvColIdx(cols, "nodes")
	techIdx := csvColIdx(cols, "techs")
	tsIdx := csvColIdx(cols, "timesteps")
	valIdx := csvColIdx(cols, valueCol)
	if nodeIdx < 0 || techIdx < 0 || tsIdx < 0 || valIdx < 0 {
		return nil, 0, fmt.Errorf("flow csv %s is missing nodes/techs/timesteps/%s columns", filename, valueCol)
	}

	tsSet := make(map[string]bool)
	var rows []flowCSVRow
	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue // malformed row: skip
		}
		node := csvRowAt(row, nodeIdx)
		tech := csvRowAt(row, techIdx)
		ts := csvRowAt(row, tsIdx)
		if node == "" || tech == "" || ts == "" {
			continue
		}
		v, perr := strconv.ParseFloat(csvRowAt(row, valIdx), 64)
		if perr != nil {
			continue
		}
		tsSet[ts] = true
		rows = append(rows, flowCSVRow{node: node, tech: tech, ts: ts, val: v})
	}

	// Deterministic index alignment: distinct timesteps sorted (RFC3339 timestamps
	// sort chronologically lexicographically).
	tsList := make([]string, 0, len(tsSet))
	for ts := range tsSet {
		tsList = append(tsList, ts)
	}
	sort.Strings(tsList)
	tsIdxMap := make(map[string]int, len(tsList))
	for i, ts := range tsList {
		tsIdxMap[ts] = i
	}

	groups := make(map[string]*flowSeries)
	for _, r := range rows {
		key := r.node + "\x00" + r.tech
		s := groups[key]
		if s == nil {
			s = &flowSeries{node: r.node, tech: r.tech, values: make([]float64, len(tsList))}
			groups[key] = s
		}
		if idx := tsIdxMap[r.ts]; idx < len(s.values) {
			s.values[idx] = r.val
		}
	}

	// Deterministic output order (Go map iteration is random): sort by series key.
	keys := make([]string, 0, len(groups))
	for k := range groups {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]pypsapass.CarrierSeries, 0, len(keys))
	for _, k := range keys {
		s := groups[k]
		out = append(out, pypsapass.CarrierSeries{
			FromLocation: s.node,
			Tech:         s.tech,
			Timeseries:   s.values,
		})
	}
	return out, len(tsList), nil
}

// pypsaPowerFlowFromBytes assembles the pypsapass.LoadOptions from the marshaled
// calculation payload (its topology + pypsa settings) and the Calliope flow CSVs,
// then runs the pass. It is the pure "parsed Calliope results + payload -> the
// isolated power flow" step, split out so it is unit-testable without a Dispatch.
func pypsaPowerFlowFromBytes(calcBytes []byte, csvDir string) (*pypsapass.PowerFlow, error) {
	var calc map[string]interface{}
	if err := json.Unmarshal(calcBytes, &calc); err != nil {
		return nil, fmt.Errorf("decode calculation payload: %w", err)
	}

	prod, prodSteps, err := readFlowCSV(csvDir, "results_flow_out.csv", "flow_out")
	if err != nil {
		return nil, fmt.Errorf("read calliope flow_out for pypsa p_set: %w", err)
	}
	con, conSteps, err := readFlowCSV(csvDir, "results_flow_in.csv", "flow_in")
	if err != nil {
		return nil, fmt.Errorf("read calliope flow_in for pypsa p_set: %w", err)
	}
	// Both sides must be index-aligned with the model's timesteps; they naturally
	// agree (same snapshots), but take the wider when they ever diverge.
	numTimesteps := prodSteps
	if conSteps > numTimesteps {
		numTimesteps = conSteps
	}

	// The topology + pypsa settings are exactly what BuildCalculationPayload
	// produced (buildTopologyFromPylovoData -> {from,to,length,pipe} features +
	// the pypsa block); pypsapass.resolver's feature() reads their
	// id/properties.id/feature_type/rated_power_kva and the pass matches buses to
	// the flow CSV node names, so pass them through verbatim.
	var topology []map[string]interface{}
	if topo, ok := calc["topology"].([]interface{}); ok {
		for _, entry := range topo {
			if em, ok := entry.(map[string]interface{}); ok {
				topology = append(topology, em)
			}
		}
	}
	var pypsa map[string]interface{}
	if p, ok := calc["pypsa"].(map[string]interface{}); ok {
		pypsa = p
	}

	return pypsapass.Build(pypsapass.LoadOptions{
		Pypsa:        pypsa,
		Topology:     topology,
		CarrierProd:  prod,
		CarrierCon:   con,
		NumTimesteps: numTimesteps,
	})
}

// injectPowerFlow embeds the pass's PowerFlow into the MEME job under the
// top-level "power_flow" key. It is deliberately top-level (NOT under
// job.model, whose schema MEME owns and must not gain an unknown key): the
// `meme-pypsa` target's run.py PF mode (Step 1C) will read it from there. The
// key is overridable/clear — a job that carries one replaces any earlier value.
func injectPowerFlow(memeJob map[string]interface{}, pf *pypsapass.PowerFlow) error {
	b, err := json.Marshal(pf)
	if err != nil {
		return fmt.Errorf("marshal power flow: %w", err)
	}
	var v interface{}
	if err := json.Unmarshal(b, &v); err != nil {
		return fmt.Errorf("decode power flow: %w", err)
	}
	memeJob["power_flow"] = v
	return nil
}

// HandleDispatchMemePyPSA is the isolated PyPSA power-flow leg: AFTER a
// successful Calliope run it builds a MEME `meme-pypsa` job from the parsed
// Calliope flow CSVs, dispatches it independently (its own leg-keyed run
// record, so it never fights the Calliope leg's "resume by id, never resubmit"
// logic), and persists the result zip. It mirrors HandleDispatchMeme's shape,
// but:
//   - gates on CalliopeLegReady (refuses without a completed Calliope leg);
//   - injects the pass's power_flow block into the job body;
//   - submits to memeTargetPyPSAOnly with a pypsa-scoped Idempotency-Key;
//   - records the run via SaveLeg(modelID, MemeLegPyPSA, ...), never Save.
//
// Terminal completed/failed is owned by the ingest handler (which enqueues next).
func HandleDispatchMemePyPSA(
	ctx context.Context,
	t *asynq.Task,
	db *gorm.DB,
	tc *tentacronclient.Client,
	runs memeLegRunStore,
	store ResultZipStore,
	locator CalliopeCSVLocator,
	enq IngestMemePyPSAEnqueuer,
) (retErr error) {
	log := logger.ForComponent("job:dispatch_meme_pypsa")

	defer func() {
		if r := recover(); r != nil {
			log.Errorf("PANIC in HandleDispatchMemePyPSA: %v", r)
			retErr = fmt.Errorf("panic in dispatch_meme_pypsa: %v", r)
		}
	}()

	var p DispatchMemePyPSAPayload
	if err := json.Unmarshal(t.Payload(), &p); err != nil {
		return fmt.Errorf("failed to unmarshal dispatch_meme_pypsa payload: %w", err)
	}

	// Any dispatch failure must leave the model in a terminal 'failed' state,
	// or it sits in 'queue' forever (see dispatch_meme.go).
	defer func() {
		if retErr != nil {
			markModelFailed(db, p.ModelID, retErr.Error())
		}
	}()

	var model commonModels.Model
	if err := db.First(&model, p.ModelID).Error; err != nil {
		return fmt.Errorf("failed to fetch model %d: %w", p.ModelID, err)
	}

	// 0. GATE: the derived leg cannot run standalone.
	if err := CalliopeLegReady(runs, p.ModelID); err != nil {
		return err
	}

	// 1. Build the calculation payload from the stored model.
	built, err := payload.BuildCalculationPayload(&model)
	if err != nil {
		return fmt.Errorf("build calculation payload for model %d: %w", p.ModelID, err)
	}
	calcBytes, err := json.Marshal(built)
	if err != nil {
		return fmt.Errorf("marshal calculation payload for model %d: %w", p.ModelID, err)
	}

	// 2. Locate the stored Calliope bundle's csv dir (the gate's second half:
	//    the run record says completed; the flow CSVs must actually be readable).
	csvDir, err := locator.CalliopeCSVDir(ctx, p.ModelID)
	if err != nil {
		return fmt.Errorf("locate calliope bundle for pypsa leg model %d: %w", p.ModelID, err)
	}

	// 3. Translate the payload into the base MEME job via the T1K seam.
	translated, err := meme.TranslatePayload(calcBytes)
	if err != nil {
		return fmt.Errorf("translate payload to MEME job for model %d: %w", p.ModelID, err)
	}
	var memeJob any
	if err := json.Unmarshal(translated.Job, &memeJob); err != nil {
		return fmt.Errorf("decode translated MEME job for model %d: %w", p.ModelID, err)
	}
	var jobMap map[string]interface{}
	if m, ok := memeJob.(map[string]interface{}); ok {
		jobMap = m
	}
	if jobMap == nil {
		jobMap = map[string]interface{}{}
	}

	// 4. Build the isolated power flow from the payload + Calliope flow CSVs and
	//    inject it into the job body as the top-level "power_flow" block.
	pf, err := pypsaPowerFlowFromBytes(calcBytes, csvDir)
	if err != nil {
		return fmt.Errorf("build pypsa power flow for model %d: %w", p.ModelID, err)
	}
	if err := injectPowerFlow(jobMap, pf); err != nil {
		return fmt.Errorf("inject power flow into MEME job for model %d: %w", p.ModelID, err)
	}

	// 5. Resolve the TentaCron job id for the PYPSA leg. No run recorded OR a
	//    terminal run -> fresh submit to meme-pypsa with a pypsa-scoped
	//    Idempotency-Key; a still-alive (running) run -> resume by id, never
	//    resubmit. Recorded via SaveLeg so it can never clobber the Calliope leg.
	rec, err := runs.GetLeg(p.ModelID, models.MemeLegPyPSA)
	if err != nil {
		return fmt.Errorf("load MEME pypsa run for model %d: %w", p.ModelID, err)
	}
	jobID := ""
	submittedNow := false
	switch {
	case rec == nil || models.MemeRunFinished(rec.Status):
		jobID, err = tc.SubmitMeme(ctx, memeTargetPyPSAOnly, jobMap, pypsaIdempotencyKey(model.ID, model.CalculationStartedAt))
		if err != nil {
			return fmt.Errorf("meme pypsa dispatch via TentaCron for model %d: %w", p.ModelID, err)
		}
		if err := runs.SaveLeg(p.ModelID, models.MemeLegPyPSA, jobID, "running"); err != nil {
			log.Errorf("model %d: failed to persist MEME pypsa TentaCron job %s: %v", p.ModelID, jobID, err)
		}
		submittedNow = true
		markModelRunning(db, p.ModelID)
		log.Infof("model %d: submitted isolated MEME pypsa job to TentaCron id=%s", p.ModelID, jobID)
	default:
		jobID = rec.RunID
		log.Infof("model %d: resuming existing MEME pypsa TentaCron job id=%s (no resubmit)", p.ModelID, jobID)
	}

	// 6. Long-poll by id on the meme budget, then read the raw zip via /result.
	if err := tc.AwaitResultByID(ctx, jobID, memePollBudget); err != nil {
		_ = runs.UpdateStatusLeg(p.ModelID, models.MemeLegPyPSA, models.MemeRunStatusFailed, err.Error())
		return fmt.Errorf("meme pypsa job %s via TentaCron for model %d: %w", jobID, p.ModelID, err)
	}
	resultZip, err := tc.FetchResultByID(ctx, jobID)
	if err != nil {
		_ = runs.UpdateStatusLeg(p.ModelID, models.MemeLegPyPSA, models.MemeRunStatusFailed, err.Error())
		return fmt.Errorf("fetch MEME pypsa result for model %d: %w", p.ModelID, err)
	}

	// 7. Store the zip under the storage/data convention, keyed to the leg so it
	//    never shadows the Calliope bundle.
	filename := fmt.Sprintf("sim_%d_pypsa.zip", model.ID)
	path, err := store.SaveZIP(ctx, model.ID, filename, resultZip)
	if err != nil {
		_ = runs.UpdateStatusLeg(p.ModelID, models.MemeLegPyPSA, models.MemeRunStatusFailed, err.Error())
		return fmt.Errorf("store MEME pypsa result zip for model %d: %w", p.ModelID, err)
	}

	// 8. Enqueue the PyPSA ingest; the terminal completed/failed transition is
	//    owned by the ingest handler, so dispatch must NOT pre-mark 'completed'.
	if err := enq.EnqueueIngestMemePyPSA(ctx, IngestMemePyPSAResultPayload{ModelID: p.ModelID, UserID: p.UserID, ZipPath: path}); err != nil {
		_ = runs.UpdateStatusLeg(p.ModelID, models.MemeLegPyPSA, models.MemeRunStatusFailed, err.Error())
		return fmt.Errorf("enqueue ingest_meme_pypsa_result for model %d: %w", p.ModelID, err)
	}
	log.Infof("model %d: enqueued MEME pypsa result ingest for stored zip %s, terminal status owned by the ingest", model.ID, path)

	if submittedNow {
		log.Infof("model %d: MEME pypsa dispatch complete, result saved to %s (%d bytes)", model.ID, path, len(resultZip))
	}
	return nil
}
