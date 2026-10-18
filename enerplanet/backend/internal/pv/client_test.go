package pv

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"spatialhub_backend/internal/tentacron"
)

// fakePVService answers every pv-simulate request through a fake TentaCron
// with a profile per array, leaving out the array ids in drop.
func fakePVService(t *testing.T, drop map[string]bool) (*tentacron.Client, *[]int) {
	t.Helper()
	var mu sync.Mutex
	var sizes []int
	responses := map[string]string{}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.Method == http.MethodPost && r.URL.Path == "/v1/requests" {
			var body struct {
				Target  string          `json:"target"`
				Payload simulateRequest `json:"payload"`
			}
			require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
			assert.Equal(t, "pv-simulate", body.Target)
			sizes = append(sizes, len(body.Payload.Arrays))
			var arrays []map[string]any
			for _, a := range body.Payload.Arrays {
				if !drop[a.ID] {
					arrays = append(arrays, map[string]any{"id": a.ID, "capacity_factor": []float64{0, a.Azimuth / 1000}})
				}
			}
			resp, _ := json.Marshal(map[string]any{"arrays": arrays})
			id := fmt.Sprintf("req-%d", len(sizes))
			responses[id] = `{"state":"completed","result":{"target_status":200,"target_response":` + string(resp) + `}}`
			w.WriteHeader(http.StatusAccepted)
			_, _ = fmt.Fprintf(w, `{"id":%q}`, id)
			return
		}
		body, ok := responses[r.URL.Path[len("/v1/requests/"):]]
		require.True(t, ok, "unexpected %s %s", r.Method, r.URL)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return tentacron.New(srv.URL, "k"), &sizes
}

func arrayRequests(n int) []ArrayRequest {
	out := make([]ArrayRequest, n)
	for i := range out {
		out[i] = ArrayRequest{ID: fmt.Sprintf("b/%d", i), Tilt: 30, Azimuth: float64(i), ModuleType: "standard"}
	}
	return out
}

func TestSimulateSplitsRequestsAtTheServiceLimit(t *testing.T) {
	tc, sizes := fakePVService(t, nil)

	profiles, err := NewClient(tc).Simulate(context.Background(), Location{Lat: 48.8, Lon: 12.9}, json.RawMessage(`{}`), arrayRequests(120))

	require.NoError(t, err)
	assert.Equal(t, []int{50, 50, 20}, *sizes)
	assert.Len(t, profiles, 120)
	assert.Equal(t, []float64{0, 0.119}, profiles["b/119"])
}

func TestSimulateFailsWhenAnArrayHasNoProfile(t *testing.T) {
	tc, _ := fakePVService(t, map[string]bool{"b/1": true})

	_, err := NewClient(tc).Simulate(context.Background(), Location{}, json.RawMessage(`{}`), arrayRequests(3))

	assert.ErrorContains(t, err, "no profile for array b/1")
}
