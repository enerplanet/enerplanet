package resultservice

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// writeStubCoati writes an executable sh stub that echoes its result-file (argv
// 2 of `convert <file> - <framework>`) and framework (argv 4) back as JSON, so
// Convert can be tested without real coati or a real .nc.
func writeStubCoati(t *testing.T, dir string) string {
	t.Helper()
	path := filepath.Join(dir, "coati-stub")
	script := "#!/bin/sh\nprintf '{\"schema_version\":\"1.0\",\"source\":\"%s\",\"framework_id\":\"%s\"}' \"$2\" \"$4\"\n"
	require.NoError(t, os.WriteFile(path, []byte(script), 0o755))
	return path
}

func TestSubprocessCoatiRunner_ConvertRunsCLI(t *testing.T) {
	stub := writeStubCoati(t, t.TempDir())

	runner := SubprocessCoatiRunner{Bin: stub}
	out, err := runner.Convert(context.Background(), "/tmp/model/output/results.nc", CoatiFrameworkCalliope07)
	require.NoError(t, err)

	doc := string(out)
	assert.Contains(t, doc, `"source":"/tmp/model/output/results.nc"`, "result file reaches the CLI")
	assert.Contains(t, doc, `"framework_id":"calliope-v0-7"`, "framework id reaches the CLI")
	assert.Contains(t, doc, `"schema_version":"1.0"`)
}

func TestSubprocessCoatiRunner_ResolvesCoatiBinEnv(t *testing.T) {
	stub := writeStubCoati(t, t.TempDir())
	t.Setenv(CoatiBinEnv, stub)

	// Empty Bin -> COATI_BIN is honoured.
	var runner SubprocessCoatiRunner
	out, err := runner.Convert(context.Background(), "f.nc", CoatiFrameworkCalliope07)
	require.NoError(t, err)
	assert.Contains(t, string(out), `"framework_id":"calliope-v0-7"`)
}

func TestSubprocessCoatiRunner_NonZeroExitIsError(t *testing.T) {
	// A stub that always fails (exit 1) proves a failed conversion surfaces the
	// coati stderr instead of silently succeeding.
	stubDir := t.TempDir()
	stub := filepath.Join(stubDir, "coati-fail")
	require.NoError(t, os.WriteFile(stub, []byte("#!/bin/sh\necho 'boom framework' >&2\nexit 1\n"), 0o755))

	runner := SubprocessCoatiRunner{Bin: stub}
	_, err := runner.Convert(context.Background(), "f.nc", "calliope-v0-7")
	require.Error(t, err)
	assert.Contains(t, err.Error(), "boom framework", "coati stderr is surfaced")
	assert.Contains(t, err.Error(), "calliope-v0-7")
}

func TestSubprocessCoatiRunner_MissingBinaryIsError(t *testing.T) {
	// Constrain PATH to an empty dir and clear COATI_BIN so no coati is found,
	// regardless of the host environment.
	t.Setenv("PATH", t.TempDir())
	t.Setenv(CoatiBinEnv, "")

	var runner SubprocessCoatiRunner
	_, err := runner.bin()
	require.Error(t, err)
	// It should mention COATI_BIN so the failure is actionable.
	assert.Contains(t, err.Error(), "COATI_BIN")
}