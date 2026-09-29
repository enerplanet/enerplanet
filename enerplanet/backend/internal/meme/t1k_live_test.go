//go:build manualignis

package meme

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"os"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Not run by `go test ./...`: needs MEME up on MEME_PORT (default 8401) with
// both pypsa and calliope targets. Run with:
//
//	cd enerplanet/backend && go test ./internal/meme/ -tags manualignis -run TestTranslatePayload_validatesAgainstLiveMeme -v
func TestTranslatePayload_validatesAgainstLiveMeme(t *testing.T) {
	base := os.Getenv("MEME_URL")
	if base == "" {
		base = "http://localhost:8401"
	}

	got, err := TranslatePayload(elOnlyPayload())
	require.NoError(t, err)

	// POST /validate?target=pypsa,calliope — the exact target set MEME's
	// TentaCron route dispatches. The translated job must pass BOTH.
	req, err := http.NewRequest(http.MethodPost, base+"/validate?target=pypsa,calliope", bytes.NewReader(got.Job))
	require.NoError(t, err)
	req.Header.Set("Content-Type", "application/json")
	resp, err := http.DefaultClient.Do(req)
	require.NoError(t, err)
	defer resp.Body.Close()
	body, err := io.ReadAll(resp.Body)
	require.NoError(t, err)

	require.Equal(t, http.StatusOK, resp.StatusCode, "job must validate clean against both targets, got %d: %s", resp.StatusCode, body)

	var out struct {
		Valid   bool      `json:"valid"`
		Targets map[string]struct {
			Valid  bool     `json:"valid"`
			Error  string   `json:"error"`
			Warns  []string `json:"warnings"`
		} `json:"targets"`
	}
	require.NoError(t, json.Unmarshal(body, &out))
	assert.True(t, out.Valid, "overall valid")
	for name, tgt := range out.Targets {
		assert.True(t, tgt.Valid, "target %s must be valid: %s", name, tgt.Error)
	}
}