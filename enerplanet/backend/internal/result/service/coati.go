package resultservice

import (
	"bytes"
	"context"
	"fmt"
	"os"
	"os/exec"
)

// CoatiRunner converts an energy-model result file (a Calliope/PyPSA netCDF,
// AdOpT HDF5) into the unified results-document JSON via Coati
// (github.com/enerplanet/Coati, the adopted result parser). It is an interface
// — mirroring the jobs.ResultZipStore pattern — so the subprocess transport
// used today can later be swapped for a sidecar HTTP service with a single new
// implementation; the ingest step depends only on this surface.
type CoatiRunner interface {
	// Convert runs Coati over resultFile and returns the results-document JSON
	// bytes. frameworkID is the Coati framework identifier (e.g.
	// CoatiFrameworkCalliope07); the id is a claim Coati itself validates.
	Convert(ctx context.Context, resultFile, frameworkID string) ([]byte, error)
}

const (
	// CoatiBinEnv names the env var holding the coati executable — the
	// explicit, environment-independent way to point the backend at Coati. The
	// docker runtime sets it to the container's provisioned venv; the local
	// dev task (.vscode/tasks.json) sets it to the hard-dependency
	// submodule's provisioned venv (submodules/Coati/.venv/bin/coati, created
	// by `make coati`). Falling back to `coati` on PATH covers a caller that
	// already has it there. There is deliberately NO relative-path guess in
	// code: the backend's working directory differs by environment
	// (enerplanet/backend locally, /app in docker), so Coati must be located
	// via COATI_BIN or PATH.
	//
	// In the container image (Dockerfile.ci) Coati is installed from the
	// submodule into the /opt/coati venv and COATI_BIN points at its binary.
	CoatiBinEnv = "COATI_BIN"

	// CoatiFrameworkCalliope07 is the framework identifier for the MEME
	// Calliope emitter (0.7.0.dev7 / 0.7.0, per the Coati table). The id is a
	// claim Coati checks against the file's actual layout.
	CoatiFrameworkCalliope07 = "calliope-v0-7"

	// CoatiFrameworkPyPSA124 is the framework identifier for the MEME PyPSA
	// emitter (pinned 1.2.4). Used for the wire mapping, which prefers the
	// PyPSA leg's network.nc.
	CoatiFrameworkPyPSA124 = "pypsa-v1-2-4"
)

// SubprocessCoatiRunner shells out to the `coati` CLI and returns its stdout
// (OUTPUT "-") as the results-document JSON. It is the only transport today; a
// sidecar HTTP implementation can replace it behind CoatiRunner.
type SubprocessCoatiRunner struct {
	// Bin is the coati executable path. Empty resolves COATI_BIN then "coati"
	// on PATH.
	Bin string
}

// bin resolves the coati executable: explicit Bin first, then COATI_BIN, then
// "coati" on PATH.
func (r SubprocessCoatiRunner) bin() (string, error) {
	if r.Bin != "" {
		return r.Bin, nil
	}
	if env := os.Getenv(CoatiBinEnv); env != "" {
		return env, nil
	}
	if _, err := exec.LookPath("coati"); err == nil {
		return "coati", nil
	}
	return "", fmt.Errorf("coati binary not found: set %s, put 'coati' on PATH, or run `make coati` and point %s at submodules/Coati/.venv/bin/coati", CoatiBinEnv, CoatiBinEnv)
}

// Convert runs `coati convert <resultFile> - <frameworkID>` and returns the
// results-document JSON on stdout.
func (r SubprocessCoatiRunner) Convert(ctx context.Context, resultFile, frameworkID string) ([]byte, error) {
	bin, err := r.bin()
	if err != nil {
		return nil, err
	}

	// OUTPUT "-" writes the document to stdout, avoiding a temp output file.
	// A failed conversion exits non-zero (1) and leaves nothing to read.
	cmd := exec.CommandContext(ctx, bin, "convert", resultFile, "-", frameworkID)
	var stderr bytes.Buffer
	cmd.Stderr = &stderr
	out, err := cmd.Output()
	if err != nil {
		return nil, fmt.Errorf("coati convert %q (framework %q): %w: %s", resultFile, frameworkID, err, stderr.String())
	}
	if len(bytes.TrimSpace(out)) == 0 {
		return nil, fmt.Errorf("coati convert %q produced empty output", resultFile)
	}
	return out, nil
}
