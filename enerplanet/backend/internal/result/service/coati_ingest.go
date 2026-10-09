package resultservice

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"gorm.io/datatypes"
	"gorm.io/gorm"

	commonModels "platform.local/common/pkg/models"
	"platform.local/platform/logger"

	resultcapabilities "spatialhub_backend/internal/result/capabilities"
)

// errCoatiLocateFound stops the ResultParser-style tree walk once a Calliope
// results.nc has been located on a path explicitly carrying a "calliope"
// segment (so a multi-target bundle doesn't lazily pick the wrong one).
var errCoatiLocateFound = errors.New("calliope results.nc found")

// errCoatiPyPSAFound stops the tree walk once a PyPSA network.nc has been
// located on a path explicitly carrying a "pypsa" segment.
var errCoatiPyPSAFound = errors.New("pypsa network.nc found")

// locatePyPSANetworkNC returns the first PyPSA network.nc under the extracted
// bundle, preferring a path containing a "pypsa" segment. It handles both MEME
// layouts: files/pypsa/run_<i>/output/network.nc (multi-target) and
// files/run_<i>/output/network.nc (single-target). It is optional — the wire
// mapping falls back to the Calliope leg when a model has no PyPSA output.
func locatePyPSANetworkNC(extractDir string) (string, error) {
	var first string
	walkErr := filepath.Walk(extractDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		if info.Name() != "network.nc" {
			return nil
		}
		if first == "" {
			first = path
		}
		if strings.Contains(strings.ToLower(path), "pypsa") {
			return errCoatiPyPSAFound
		}
		return nil
	})
	if walkErr != nil && !errors.Is(walkErr, errCoatiPyPSAFound) {
		return "", walkErr
	}
	if first == "" {
		return "", fmt.Errorf("no PyPSA network.nc found under %s", extractDir)
	}
	return first, nil
}

// locateCalliopeResultsNC returns the first Calliope results.nc under the
// extracted bundle, preferring a path containing a "calliope" segment. It
// handles both MEME layouts seen in the real bundles:
//   - per-target:  files/calliope/run_<i>/output/results.nc
//   - single-target: files/run_<i>/output/results.nc
//
// The PyPSA leg's network.nc is located separately (locatePyPSANetworkNC).
func locateCalliopeResultsNC(extractDir string) (string, error) {
	var first string
	walkErr := filepath.Walk(extractDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || info.IsDir() {
			return nil
		}
		if info.Name() != "results.nc" {
			return nil
		}
		if first == "" {
			first = path
		}
		if strings.Contains(strings.ToLower(path), "calliope") {
			return errCoatiLocateFound
		}
		return nil
	})
	if walkErr != nil && !errors.Is(walkErr, errCoatiLocateFound) {
		return "", walkErr
	}
	if first == "" {
		return "", fmt.Errorf("no Calliope results.nc found under %s", extractDir)
	}
	return first, nil
}

// splitLocTech splits a Coati "loc::tech" capacity key into its location and
// technology. Transmission capacities (e.g. "n1::line1") carry no remote
// location in the Coati document, so ToLoc is left empty here.
func splitLocTech(key string) (loc, tech string) {
	parts := strings.SplitN(key, "::", 2)
	if len(parts) != 2 {
		return "", ""
	}
	return parts[0], parts[1]
}

func appendUnique(slice []string, v string) []string {
	for _, s := range slice {
		if s == v {
			return slice
		}
	}
	return append(slice, v)
}

// mapCoatiDocument converts the Coati results document into the R2 small/summary
// shape (ParsedResults) so the ingest reuses deleteExistingResults and the
// storeSmallResults transaction store funcs. Large per-timestep series are not
// mapped — see the CoatiResultsDocument notes (they are deferred).
func mapCoatiDocument(doc *CoatiResultsDocument) (*ParsedResults, error) {
	out := &ParsedResults{
		Coordinates: make(map[string]Coordinate),
		LocTechs:    make(map[string][]string),
	}

	for loc, xy := range doc.Coordinates {
		c := Coordinate{}
		if len(xy) > 0 {
			c.X = xy[0]
		}
		if len(xy) > 1 {
			c.Y = xy[1]
		}
		out.Coordinates[loc] = c
	}

	// Installed capacities (and storage capacity) -> results_energy_cap, and
	// every emitted tech registers its loc-tech pair for lookup. The names are
	// rewritten through the SAME shared rules the time-series tables use
	// (classifyMemeTech/normMemeTech): demand -> <loc>_demand, grid import ->
	// transformer_supply, grid export is an offtake and is omitted entirely.
	// Both capacities and storage capacities become energy-cap rows, matching
	// how the legacy Calliope results_energy_cap.csv carried flow_cap +
	// storage_cap.
	techParents := make(map[string]string, len(doc.TechMetadata))
	for tech, meta := range doc.TechMetadata {
		techParents[tech] = meta.Parent
	}

	// Transmission capacities are reported once PER ENDPOINT ("n1::lv_1_trafo_82"
	// and "ntrafo_82::lv_1_trafo_82"). Collect the endpoints and emit ONE
	// power_transmission row pairing them, mirroring the legacy vocabulary
	// (from_location = one endpoint, to_location = the other).
	type wireEndpoints struct {
		locs  []string
		value float64
	}
	wires := make(map[string]*wireEndpoints)

	registerLocTech := func(loc, tech string) {
		if loc == "" || tech == "" {
			return
		}
		out.LocTechs[loc] = appendUnique(out.LocTechs[loc], tech)
	}
	addEnergyCap := func(loc, tech string, value float64) {
		registerLocTech(loc, tech)
		out.EnergyCap = append(out.EnergyCap, EnergyCap{Location: loc, Tech: tech, Value: value})
	}

	// power is true for installed POWER capacities (MW -> kW, the R2 contract)
	// and false for storage ENERGY capacities (MWh is not power and must not be
	// scaled).
	addCapacity := func(loc, tech string, value float64, power bool) {
		if loc == "" || tech == "" {
			return
		}
		if power {
			value = mwToKw(value)
		}
		switch classifyMemeTech(tech, techParents) {
		case memeTechGridExport:
			return // offtake, not generation/supply — omit like the time-series path
		case memeTechTransmission:
			w := wires[tech]
			if w == nil {
				w = &wireEndpoints{}
				wires[tech] = w
			}
			known := false
			for _, l := range w.locs {
				if l == loc {
					known = true
					break
				}
			}
			if !known {
				w.locs = append(w.locs, loc)
			}
			if value > w.value {
				w.value = value
			}
			return
		}
		normTech, keep := normMemeTech(tech, loc, techParents)
		if !keep || normTech == "" {
			return
		}
		addEnergyCap(loc, normTech, value)
	}
	for key, value := range doc.Capacities {
		loc, tech := splitLocTech(key)
		addCapacity(loc, tech, value, true) // power capacity: MW -> kW
	}
	for key, value := range doc.StorageCapacities {
		loc, tech := splitLocTech(key)
		addCapacity(loc, tech, value, false) // energy capacity (MWh) is not power
	}

	// Emit the paired wire rows deterministically (Go map iteration is random).
	wireTechs := make([]string, 0, len(wires))
	for tech := range wires {
		wireTechs = append(wireTechs, tech)
	}
	sort.Strings(wireTechs)
	for _, tech := range wireTechs {
		w := wires[tech]
		sort.Strings(w.locs)
		if len(w.locs) == 2 {
			from, to := w.locs[0], w.locs[1]
			out.EnergyCap = append(out.EnergyCap, EnergyCap{Location: from, Tech: "power_transmission", ToLoc: to, Value: w.value})
			registerLocTech(from, "power_transmission:"+to)
			registerLocTech(to, "power_transmission:"+from)
			continue
		}
		// Broken/ambiguous endpoint set (!= 2): still emit the transmission
		// tech, but there is no honest remote endpoint to name.
		from := ""
		if len(w.locs) > 0 {
			from = w.locs[0]
		}
		out.EnergyCap = append(out.EnergyCap, EnergyCap{Location: from, Tech: "power_transmission", Value: w.value})
		registerLocTech(from, "power_transmission")
	}

	// Costs -> results_cost, from the per-location, per-tech totals.
	for loc, techCosts := range doc.CostsByLocation {
		for tech, value := range techCosts {
			out.Cost = append(out.Cost, CostRecord{FromLocation: loc, Costs: "monetary", Techs: tech, Value: value})
		}
	}
	// Fallback: systemwide per-tech costs when no per-location breakdown exists.
	if len(out.Cost) == 0 {
		for tech, value := range doc.CostsByTech {
			out.Cost = append(out.Cost, CostRecord{Costs: "monetary", Techs: tech, Value: value})
		}
	}

	return out, nil
}

// loadCableRatings resolves the conservative per-grid wire rating (MVA) from the
// model's stored config (models.config), keyed by grid_result_id. This is the
// only place the ingest reaches outside the result bundle: a MEME bundle carries
// no nameplate, only the LP-optimised flow_cap, so a real utilisation must come
// from the config's cable types. A load/parse failure is NON-FATAL — the wires
// then carry no loading_percent rather than the fabricated 100.
func (s *ResultService) loadCableRatings(modelID uint) map[string]float64 {
	log := logger.ForComponent("result")

	var row struct {
		Config datatypes.JSON `gorm:"column:config"`
	}
	if err := s.db.Raw("SELECT config FROM models WHERE id = ?", modelID).Scan(&row).Error; err != nil {
		log.Warnf("Wire rating: could not load model config model_id=%d err=%v; loading_percent will be NULL", modelID, err)
		return nil
	}
	if len(row.Config) == 0 {
		return nil
	}
	var config map[string]interface{}
	if err := json.Unmarshal(row.Config, &config); err != nil {
		log.Warnf("Wire rating: model config is not valid JSON model_id=%d err=%v; loading_percent will be NULL", modelID, err)
		return nil
	}
	ratings := wireRatingsByGrid(config)
	if len(ratings) == 0 {
		log.Warnf("Wire rating: no cable ratings resolved from model config model_id=%d; loading_percent will be NULL", modelID)
		return nil
	}
	log.Infof("Wire rating: resolved %d per-grid cable ratings from model config model_id=%d", len(ratings), modelID)
	return ratings
}

// IngestCoatiResult is the MEME result ingest: it extracts a stored MEME result
// zip, runs Coati over the Calliope results.nc, maps the unified document into
// the R2 small/summary tables, and writes a compact summary to model.results.
// Wire loading prefers the bundle's PyPSA network.nc when present.
//
// It follows the ProcessModelResult transaction pattern: deleteExistingResults
// then storeSmallResults in a single transaction, so re-runs are idempotent.
// Time-series tables are streamed from the Calliope leg's long-format CSVs, not
// from the Coati document, whose series are tech- and location-aggregated.
func (s *ResultService) IngestCoatiResult(ctx context.Context, modelID uint, userID, zipPath string, runner CoatiRunner) (summary *CoatiSummary, retErr error) {
	log := logger.ForComponent("result")

	defer func() {
		if r := recover(); r != nil {
			log.Errorf("PANIC in IngestCoatiResult model_id=%d: %v", modelID, r)
			retErr = fmt.Errorf("panic in IngestCoatiResult: %v", r)
		}
	}()

	zipStat, err := os.Stat(zipPath)
	if err != nil {
		log.Errorf("Result zip not found model_id=%d zip_path=%s err=%v", modelID, zipPath, err)
		return nil, fmt.Errorf("zip file not found: %w", err)
	}
	_ = zipStat

	extractDir := filepath.Dir(zipPath)
	if err := s.extractZip(zipPath, extractDir); err != nil {
		log.Errorf("Failed to extract zip model_id=%d err=%v", modelID, err)
		return nil, fmt.Errorf("failed to extract zip: %w", err)
	}

	resultsFile, err := locateCalliopeResultsNC(extractDir)
	if err != nil {
		log.Errorf("Locate results.nc failed model_id=%d err=%v", modelID, err)
		return nil, err
	}

	// Run Coati (the Python parser owns the .nc read). No Go netCDF parsing.
	docJSON, err := runner.Convert(ctx, resultsFile, CoatiFrameworkCalliope07)
	if err != nil {
		log.Errorf("Coati convert failed model_id=%d file=%s err=%v", modelID, resultsFile, err)
		return nil, fmt.Errorf("coati convert failed: %w", err)
	}

	var doc CoatiResultsDocument
	if err := json.Unmarshal(docJSON, &doc); err != nil {
		log.Errorf("Failed to decode Coati document model_id=%d err=%v", modelID, err)
		return nil, fmt.Errorf("decode Coati document: %w", err)
	}
	if doc.SchemaVersion != "1.0" {
		log.Warnf("Coati document schema_version=%q (expected 1.0) model_id=%d", doc.SchemaVersion, modelID)
	}

	parsed, err := mapCoatiDocument(&doc)
	if err != nil {
		log.Errorf("Map Coati document failed model_id=%d err=%v", modelID, err)
		return nil, fmt.Errorf("map Coati document: %w", err)
	}

	// Wire loading: one mapping serves both legs, because Coati normalises PyPSA
	// and Calliope to the same transmission_flow + capacities contract. Prefer
	// the PyPSA leg (the electricity transport model) and fall back to the
	// Calliope document already parsed — never concatenate the two, they are
	// two different solves of the same wires.
	// The wire loading_percent is a REAL utilisation against the
	// weakest cable in each grid (resolved once from the model's stored config),
	// not the LP-optimised flow_cap Coati reports (which makes |flow|/rating
	// identically 100). A wire with no resolvable rating carries NULL, never the
	// artefact.
	cableRatings := s.loadCableRatings(modelID)
	wireDoc := wireDocument(ctx, &doc, extractDir, runner, log, modelID)
	parsed.PyPSALineLoading = mapWireLoading(wireDoc, cableRatings)

	summary = buildCoatiSummary(&doc)
	summary.LineCount = len(wireDoc.TransmissionFlow)
	summaryJSON, err := json.Marshal(summary)
	if err != nil {
		log.Errorf("Failed to marshal Coati summary model_id=%d err=%v", modelID, err)
		return nil, fmt.Errorf("marshal Coati summary: %w", err)
	}

	// The Calliope leg writes long-format CSVs (already in R2 shape) beside the
	// results.nc it was parsed from. They carry the per-location × per-tech ×
	// per-timestep matrix the Coati document lacks, so the R2 time-series tables
	// are streamed from them (PyPSA-only bundles have no such dir → skipped).
	csvDir := filepath.Join(filepath.Dir(resultsFile), "csv")
	techParents := make(map[string]string, len(doc.TechMetadata))
	for tech, meta := range doc.TechMetadata {
		techParents[tech] = meta.Parent
	}

	// Delete existing R2 rows, replace the ModelResult row, stream the
	// time-series, and store the small/summary results atomically. The
	// ModelResult row is what the results list + download endpoints read
	// (GetModelResults / DownloadModelResult); the legacy power-flow path records
	// it in ProcessModelResult, and a MEME ingest must do the same or those
	// endpoints 404 for the model.
	if err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := s.deleteExistingResults(tx, modelID); err != nil {
			return err
		}
		if err := replaceModelResultRow(tx, modelID, userID, zipPath, extractDir, zipStat.Size(), summaryJSON); err != nil {
			return err
		}
		if err := streamMemeTimeSeries(tx, modelID, csvDir, techParents); err != nil {
			return err
		}
		return s.storeSmallResultsTx(tx, log, modelID, parsed)
	}); err != nil {
		log.Errorf("Failed to store Coati results model_id=%d err=%v", modelID, err)
		return nil, fmt.Errorf("failed to store Coati results: %w", err)
	}

	if err := s.db.Model(&commonModels.Model{}).Where("id = ?", modelID).Updates(map[string]any{
		"results":       datatypes.JSON(summaryJSON),
		"result_source": string(resultcapabilities.SourceMeme),
	}).Error; err != nil {
		log.Warnf("Failed to update model.results model_id=%d err=%v", modelID, err)
	}

	log.Infof("Ingested MEME result via Coati model_id=%d success=%v capacities=%d", modelID, doc.doesCoatiSucceed(), summary.EnergyCapCount)
	return summary, nil
}

// replaceModelResultRow writes the ModelResult row the result list and download
// endpoints read (store.GetModelResults / DownloadModelResult). The legacy
// power-flow path records one in ProcessModelResult; a MEME/Coati ingest must
// record one too, or /results and the download route 404 for the model even
// though the zip and parsed tables exist.
//
// A MEME bundle carries no TIF or geoserver artefacts (unlike the legacy
// power-flow zip), so only the zip + extracted paths are set and the Coati
// summary JSON becomes the row metadata. It is replaced (delete-then-create) on
// every ingest so a re-run never accumulates rows.
func replaceModelResultRow(tx *gorm.DB, modelID uint, userID, zipPath, extractDir string, size int64, metadata []byte) error {
	if err := tx.Where("model_id = ?", modelID).Delete(&commonModels.ModelResult{}).Error; err != nil {
		return fmt.Errorf("delete prior result row: %w", err)
	}
	row := &commonModels.ModelResult{
		ModelID:          modelID,
		UserID:           userID,
		ZipPath:          zipPath,
		ExtractedPath:    extractDir,
		FileSizeBytes:    size,
		ExtractionStatus: commonModels.ResultExtractionCompleted,
		Metadata:         datatypes.JSON(metadata),
	}
	if err := tx.Create(row).Error; err != nil {
		return fmt.Errorf("create result row: %w", err)
	}
	return nil
}
