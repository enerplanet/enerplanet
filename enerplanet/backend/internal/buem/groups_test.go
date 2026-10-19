package buem

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"spatialhub_backend/internal/tentacron"
)

func TestGroups_SplitsInOrder(t *testing.T) {
	var buildings []Building
	var keys []string
	for i := range 25 {
		buildings = append(buildings, Building{ID: fmt.Sprint(i)})
		keys = append(keys, fmt.Sprintf("k%d", i))
	}
	groups := Groups(buildings, keys, 10)
	require.Len(t, groups, 3)
	assert.Len(t, groups[0].Buildings, 10)
	assert.Len(t, groups[2].Buildings, 5)
	assert.Equal(t, "20", groups[2].Buildings[0].ID)
	assert.Equal(t, "k20", groups[2].Keys[0])
}

// batchServer answers POST /v1/requests/batch, recording the items it got.
func batchServer(t *testing.T) (*tentacron.Client, *[]map[string]any) {
	t.Helper()
	var got []map[string]any
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, "/v1/requests/batch", r.URL.Path)
		var body struct {
			Requests []map[string]any `json:"requests"`
		}
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		got = body.Requests
		answer := make([]map[string]any, len(got))
		for i := range got {
			answer[i] = map[string]any{"id": fmt.Sprintf("req-%d", i)}
		}
		w.WriteHeader(http.StatusAccepted)
		require.NoError(t, json.NewEncoder(w).Encode(map[string]any{"items": answer}))
	}))
	t.Cleanup(srv.Close)
	return tentacron.New(srv.URL, "key"), &got
}

func TestSubmitGroups_KeepsSeriesAndKeysEachGroup(t *testing.T) {
	tc, got := batchServer(t)
	groups := []Group{
		{Buildings: []Building{{ID: "a", Building: json.RawMessage(`{}`)}}, Keys: []string{"ka"}},
		{Buildings: []Building{{ID: "b", Building: json.RawMessage(`{}`)}}, Keys: []string{"kb"}},
	}
	jobs, err := NewClient(tc).SubmitGroups(context.Background(), groups, json.RawMessage(`{}`), "1900-01-01T00:00:00Z", "1900-12-31T23:00:00Z", 60, "7")
	require.NoError(t, err)

	require.Len(t, jobs, 2)
	assert.Equal(t, "req-1", jobs[1].ID)
	require.Len(t, *got, 2)
	first, second := (*got)[0], (*got)[1]
	assert.Equal(t, "buem-buildings", first["target"])
	assert.Equal(t, true, first["payload"].(map[string]any)["keep_timeseries"])
	assert.NotEqual(t, first["idempotency_key"], second["idempotency_key"])

	again, err := NewClient(tc).SubmitGroups(context.Background(), groups[:1], json.RawMessage(`{}`), "1900-01-01T00:00:00Z", "1900-12-31T23:00:00Z", 60, "7")
	require.NoError(t, err)
	require.Len(t, again, 1)
	assert.Equal(t, first["idempotency_key"], (*got)[0]["idempotency_key"], "the same group and model give the same key")

	_, err = NewClient(tc).SubmitGroups(context.Background(), groups[:1], json.RawMessage(`{}`), "1900-01-01T00:00:00Z", "1900-12-31T23:00:00Z", 60, "8")
	require.NoError(t, err)
	assert.NotEqual(t, first["idempotency_key"], (*got)[0]["idempotency_key"], "another model gets another key")
}

// buem-gateway takes outputs once per request, so only a one-building
// request carries them.
func TestBatchPayload_OutputsOnlyForOneBuilding(t *testing.T) {
	b := building("1", testBlock)
	b.Outputs = json.RawMessage(`{"cooling": "none"}`)

	one, err := batchPayload([]Building{b}, json.RawMessage(testWeather), "", "", 60, "", true)
	require.NoError(t, err)
	assert.JSONEq(t, `{"cooling": "none"}`, string(one["outputs"].(json.RawMessage)))

	two, err := batchPayload([]Building{b, building("2", testBlock)}, json.RawMessage(testWeather), "", "", 60, "", true)
	require.NoError(t, err)
	assert.NotContains(t, two, "outputs")
}

func TestBatchSpans_StayWithinBudgetAndItemLimit(t *testing.T) {
	assert.Equal(t, [][2]int{{0, 2}, {2, 4}, {4, 5}}, batchSpans([]int{4, 4, 4, 4, 4}, 10, 100), "two items of 4 fit a budget of 10")
	assert.Equal(t, [][2]int{{0, 1}, {1, 2}}, batchSpans([]int{20, 3}, 10, 100), "an item over budget goes alone")
	assert.Equal(t, [][2]int{{0, 2}, {2, 3}}, batchSpans([]int{1, 1, 1}, 100, 2), "the item limit splits too")
	assert.Empty(t, batchSpans(nil, 10, 100))
}

// Every group repeats the model's weather, so a large model's groups must not
// travel in one request over TentaCron's body limit.
func TestSubmitGroups_SplitsRequestsByEncodedSize(t *testing.T) {
	var requests [][]string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body struct {
			Requests []struct {
				IdempotencyKey string `json:"idempotency_key"`
			} `json:"requests"`
		}
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		keys := make([]string, len(body.Requests))
		answer := make([]map[string]any, len(body.Requests))
		for i, it := range body.Requests {
			keys[i] = it.IdempotencyKey
			answer[i] = map[string]any{"id": it.IdempotencyKey}
		}
		requests = append(requests, keys)
		w.WriteHeader(http.StatusAccepted)
		require.NoError(t, json.NewEncoder(w).Encode(map[string]any{"items": answer}))
	}))
	t.Cleanup(srv.Close)
	var groups []Group
	for i := range 5 {
		id := fmt.Sprintf("b%d", i)
		groups = append(groups, Group{Buildings: []Building{{ID: id, Building: json.RawMessage(`{}`)}}, Keys: []string{"k" + id}})
	}
	weather := json.RawMessage(`{"T": [` + strings.Repeat("1.5,", 999) + `1.5]}`)

	jobs, err := NewClient(tentacron.New(srv.URL, "key")).submitGroups(context.Background(), groups, weather,
		"1900-01-01T00:00:00Z", "1900-12-31T23:00:00Z", 60, "7", 9000)
	require.NoError(t, err)

	assert.Len(t, requests, 3, "about 4 KB per group against a 9 KB budget: two per request")
	require.Len(t, jobs, 5)
	for i, j := range jobs {
		assert.Equal(t, groups[i].Buildings[0].ID, j.Group.Buildings[0].ID, "jobs keep the order of the groups")
		assert.NotEmpty(t, j.ID)
	}
}
