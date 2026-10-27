package resultservice

import (
	"context"
	"encoding/csv"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"

	commonModels "platform.local/common/pkg/models"
	"platform.local/platform/logger"

	resultcapabilities "spatialhub_backend/internal/result/capabilities"
)

// PyPSASummary is the compact result the isolated PyPSA ingest records. It is
// deliberately small: the Calliope summary stays the model's primary result
// (the PyPSA leg ENRICHES it — it must never clobber model.results), so this
// carries only the power-flow verdict + coverage.
type PyPSASummary struct {
	// Converged reports whether the PF converged. A non-converged (or absent)
	// PF is a normal outcome — the model still completes with the electrical
	// sections gated off.
	Converged          bool `json:"converged"`
	ConvergedSnapshots int  `json:"converged_snapshots,omitempty"`
	TotalSnapshots     int  `json:"total_snapshots,omitempty"`
	// LineCount is the number of wires the PF export carried.
	LineCount int `json:"line_count,omitempty"`
}

// PyPSAIngester is the injected seam for the isolated PyPSA bundle ingest —
// mirroring CoatiRunner — so the jobs ingest handler can be tested without a
// real DB or extracted bundle.
type PyPSAIngester interface {
	IngestPyPSAResult(ctx context.Context, modelID uint, userID, zipPath string) (*PyPSASummary, error)
}

// resultServicePyPSAIngester adapts ResultService.IngestPyPSAResult to PyPSAIngester.
type resultServicePyPSAIngester struct {
	svc *ResultService
}

// NewResultServicePyPSAIngester returns a PyPSAIngester backed by ResultService.
func NewResultServicePyPSAIngester(svc *ResultService) PyPSAIngester {
	return &resultServicePyPSAIngester{svc: svc}
}

func (r *resultServicePyPSAIngester) IngestPyPSAResult(ctx context.Context, modelID uint, userID, zipPath string) (*PyPSASummary, error) {
	return r.svc.IngestPyPSAResult(ctx, modelID, userID, zipPath)
}

// locatePyPSAOutputDir returns the PyPSA output directory (the parent of the
// csv_sim_* dir holding buses-v_mag_pu / lines-p0 / transformers-* ...), or ""
// when the bundle has no PF export. A missing PF export is a NORMAL outcome:
// the legacy convergence guard clears the entire export when any snapshot
// fails to converge, and a MEME pypsa bundle whose run.py has no PF mode yet
// carries no such dir either. Both must complete the model, with the
// electrical sections gated off.
func locatePyPSAOutputDir(extractDir string) string {
	var found string
	_ = filepath.Walk(extractDir, func(path string, info os.FileInfo, err error) error {
		if err != nil || !info.IsDir() {
			return nil
		}
		if strings.HasPrefix(info.Name(), "csv_sim_") && found == "" {
			found = filepath.Dir(path) // the pypsa_output-style parent
		}
		return nil
	})
	return found
}

// readPyPSAConvergence reads the PF convergence verdict from
// <pypsaDir>/convergence_stats.csv (legacy name), and falls back to a
// pf_result.csv "false"-anywhere scan when the stats file is absent. A missing
// file is not an error: convergence is simply left unknown.
func readPyPSAConvergence(pypsaDir string) *PyPSASummary {
	summary := &PyPSASummary{}

	statsPath := filepath.Join(pypsaDir, "convergence_stats.csv")
	if file, err := os.Open(statsPath); err == nil {
		defer file.Close()
		reader := csv.NewReader(file)
		header, err := reader.Read()
		if err != nil {
			return summary
		}
		row, err := reader.Read()
		if err != nil {
			return summary
		}
		cols := make(map[string]int, len(header))
		for i, h := range header {
			cols[strings.ToLower(strings.TrimSpace(h))] = i
		}
		summary.ConvergedSnapshots = int(pypsaConvergenceFloat(row, cols, "converged_snapshots"))
		summary.TotalSnapshots = int(pypsaConvergenceFloat(row, cols, "total_snapshots"))
		summary.Converged = summary.ConvergedSnapshots > 0 && summary.ConvergedSnapshots == summary.TotalSnapshots
		return summary
	}

	// Fallback: pf_result.csv where any cell reads "false" means non-convergence.
	pfPath := filepath.Join(pypsaDir, "pf_result.csv")
	if file, err := os.Open(pfPath); err == nil {
		defer file.Close()
		reader := csv.NewReader(file)
		_, _ = reader.Read() // header
		converged := true
		for {
			row, err := reader.Read()
			if err == io.EOF {
				break
			}
			if err != nil {
				converged = false
				break
			}
			for _, col := range row {
				if strings.EqualFold(strings.TrimSpace(col), "false") {
					converged = false
					break
				}
			}
			if !converged {
				break
			}
		}
		summary.Converged = converged
		return summary
	}

	// Neither present: PF output absent. Leave Converged false-ish; the model
	// still completes (the sections stay gated off by the missing rows).
	return summary
}

func pypsaConvergenceFloat(row []string, cols map[string]int, name string) float64 {
	if i, ok := cols[name]; ok && i >= 0 && i < len(row) {
		if v, err := strconv.ParseFloat(strings.TrimSpace(row[i]), 64); err == nil {
			return v
		}
	}
	return 0
}

// countLineRows returns the number of wire rows in lines-p0.csv under the PF
// export (excluding the header), 0 when absent.
func countLineRows(pypsaDir string) int {
	csvDir, err := findCSVSimDir(pypsaDir)
	if err != nil {
		return 0
	}
	file, err := os.Open(filepath.Join(csvDir, "lines-p0.csv"))
	if err != nil {
		return 0
	}
	defer file.Close()
	reader := csv.NewReader(file)
	_, _ = reader.Read() // header
	count := 0
	for {
		row, err := reader.Read()
		if err == io.EOF {
			break
		}
		if err != nil {
			continue
		}
		_ = row
		count++
	}
	return count
}

// IngestPyPSAResult is the isolated PyPSA leg's ingest: it extracts the stored
// `meme-pypsa` bundle, streams the electrical PF files (bus voltage, bus power,
// line flows + loading, transformer flows) into the electrical R2 tables with
// the existing StreamingInserter readers, records the convergence verdict, and
// flips the model's capability source to full-grid-pf.
//
// By design it does NOT delete or replace the Calliope results/summary: the
// PyPSA leg ENRICHES the model (the electrical tables feed the Grid sections;
// the Calliope summary stays the primary result). Only result_source changes.
// A missing/empty PF export (non-convergence cleared it, or the target hasn't
// produced one yet) is a normal outcome — the model still completes; the
// electrical tables are simply not populated.
func (s *ResultService) IngestPyPSAResult(ctx context.Context, modelID uint, userID, zipPath string) (summary *PyPSASummary, retErr error) {
	log := logger.ForComponent("result")

	defer func() {
		if r := recover(); r != nil {
			log.Errorf("PANIC in IngestPyPSAResult model_id=%d: %v", modelID, r)
			retErr = fmt.Errorf("panic in IngestPyPSAResult: %v", r)
		}
	}()

	_ = userID
	if _, err := os.Stat(zipPath); err != nil {
		log.Errorf("PyPSA result zip not found model_id=%d zip_path=%s err=%v", modelID, zipPath, err)
		return nil, fmt.Errorf("zip file not found: %w", err)
	}

	extractDir := filepath.Dir(zipPath)
	if err := s.extractZip(zipPath, extractDir); err != nil {
		log.Errorf("Failed to extract PyPSA zip model_id=%d err=%v", modelID, err)
		return nil, fmt.Errorf("failed to extract zip: %w", err)
	}

	pypsaDir := locatePyPSAOutputDir(extractDir)
	psummary := readPyPSAConvergence(pypsaDir)

	if pypsaDir != "" {
		// Stream the electrical tables best-effort. Each is optional and
		// independent: a non-converged (cleared) export is NORMAL, so a failure
		// to stream one table must not fail the model — only gate that section.
		inserter := NewStreamingInserter(ctx, s.db, modelID, 1)
		if err := inserter.StreamPyPSAVoltage(pypsaDir); err != nil && !os.IsNotExist(err) {
			log.Warnf("PyPSA stream voltage skipped model_id=%d err=%v", modelID, err)
		}
		if err := inserter.StreamPyPSAPower(pypsaDir); err != nil && !os.IsNotExist(err) {
			log.Warnf("PyPSA stream power skipped model_id=%d err=%v", modelID, err)
		}
		if err := inserter.StreamPyPSALineLoading(pypsaDir); err != nil && !os.IsNotExist(err) {
			log.Warnf("PyPSA stream line loading skipped model_id=%d err=%v", modelID, err)
		}
		if err := inserter.StreamLineFlows(pypsaDir); err != nil && !os.IsNotExist(err) {
			log.Warnf("PyPSA stream line flows skipped model_id=%d err=%v", modelID, err)
		}
		if err := inserter.StreamTransformerFlows(pypsaDir); err != nil && !os.IsNotExist(err) {
			log.Warnf("PyPSA stream transformer flows skipped model_id=%d err=%v", modelID, err)
		}
		psummary.LineCount = countLineRows(pypsaDir)
	}

	// Flip the capability source to full-grid-pf. A converged export carries
	// real electrical data; a non-/empty one flips coverage (Converged=false)
	// and leaves the Grid sections gated. model.results is intentionally left
	// untouched so the Calliope summary the result list reads is preserved.
	updatesErr := s.db.Model(&commonModels.Model{}).Where("id = ?", modelID).Updates(map[string]any{
		"result_source": string(resultcapabilities.SourceFullGridPF),
	}).Error
	if updatesErr != nil {
		log.Warnf("Failed to set model result_source=full-grid-pf model_id=%d err=%v", modelID, updatesErr)
	}

	log.Infof("Ingested MEME pypsa result model_id=%d converged=%v lines=%d", modelID, psummary.Converged, psummary.LineCount)
	return psummary, nil
}
