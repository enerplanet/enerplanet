package resultservice

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"gorm.io/datatypes"
	"gorm.io/gorm"

	commonModels "platform.local/common/pkg/models"
	"platform.local/platform/logger"
)

// errCoatiLocateFound stops the ResultParser-style tree walk once a Calliope
// results.nc has been located on a path explicitly carrying a "calliope"
// segment (so a multi-target bundle doesn't lazily pick the wrong one).
var errCoatiLocateFound = errors.New("calliope results.nc found")

// locateCalliopeResultsNC returns the first Calliope results.nc under the
// extracted bundle, preferring a path containing a "calliope" segment. It
// handles both MEME layouts seen in the real bundles:
//   - per-target:  files/calliope/run_<i>/output/results.nc
//   - single-target: files/run_<i>/output/results.nc
//
// PyPSA writes network.nc and is a later step; this ingest is Calliope-only.
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
	// every "loc::tech" key registers the loc-tech pair for lookup. Both
	// capacities and storage capacities become energy-cap rows, matching how the
	// legacy Calliope results_energy_cap.csv carried flow_cap + storage_cap.
	addEnergyCap := func(key string, value float64) {
		loc, tech := splitLocTech(key)
		if loc == "" || tech == "" {
			return
		}
		out.LocTechs[loc] = appendUnique(out.LocTechs[loc], tech)
		out.EnergyCap = append(out.EnergyCap, EnergyCap{Location: loc, Tech: tech, Value: value})
	}
	for key, value := range doc.Capacities {
		addEnergyCap(key, value)
	}
	for key, value := range doc.StorageCapacities {
		addEnergyCap(key, value)
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

// IngestCoatiResult is Step 6's ingest: it extracts a stored MEME result zip,
// runs Coati over the Calliope results.nc, maps the unified document into the
// R2 small/summary tables, and writes a compact summary to model.results. It is
// Calliope-electricity-only for now (PyPSA is a later step).
//
// It follows the ProcessModelResult transaction pattern: deleteExistingResults
// then storeSmallResults in a single transaction, so re-runs are idempotent.
// Large time-series tables (results_carrier_prod/con, system_balance, etc.) are
// NOT streamed here — Coati's dispatch/demand series are tech- and
// location-aggregated and don't carry the per-location/per-carrier/timestep
// dimensions those tables need; streaming is deferred (documented in the plan).
func (s *ResultService) IngestCoatiResult(ctx context.Context, modelID uint, zipPath string, runner CoatiRunner) (summary *CoatiSummary, retErr error) {
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

	// Delete existing R2 rows and store the small/summary results atomically.
	if err := s.db.Transaction(func(tx *gorm.DB) error {
		if err := s.deleteExistingResults(tx, modelID); err != nil {
			return err
		}
		return s.storeSmallResultsTx(tx, log, modelID, parsed)
	}); err != nil {
		log.Errorf("Failed to store Coati results model_id=%d err=%v", modelID, err)
		return nil, fmt.Errorf("failed to store Coati results: %w", err)
	}

	summary = buildCoatiSummary(&doc)
	summaryJSON, err := json.Marshal(summary)
	if err != nil {
		log.Errorf("Failed to marshal Coati summary model_id=%d err=%v", modelID, err)
		return nil, fmt.Errorf("marshal Coati summary: %w", err)
	}
	if err := s.db.Model(&commonModels.Model{}).Where("id = ?", modelID).Update("results", datatypes.JSON(summaryJSON)).Error; err != nil {
		log.Warnf("Failed to update model.results model_id=%d err=%v", modelID, err)
	}

	log.Infof("Ingested MEME result via Coati model_id=%d success=%v capacities=%d", modelID, doc.doesCoatiSucceed(), summary.EnergyCapCount)
	return summary, nil
}