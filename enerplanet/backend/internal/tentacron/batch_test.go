package tentacron

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func batchAnswer(t *testing.T, status int, body string) *Client {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		assert.Equal(t, http.MethodPost, r.Method)
		assert.Equal(t, "/v1/requests/batch", r.URL.Path)
		var req map[string]json.RawMessage
		assert.NoError(t, json.NewDecoder(r.Body).Decode(&req))
		assert.Contains(t, req, "requests", "TentaCron reads the list from requests")
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return New(srv.URL, "key")
}

func TestSubmitBatch_MapsIDsAndItemErrors(t *testing.T) {
	c := batchAnswer(t, http.StatusAccepted, `{"items": [{"id": "req-1", "state": "received"},
		{"error": {"code": "queue_full", "message": "this key already holds 100 queued requests"}}]}`)
	got, err := c.SubmitBatch(context.Background(), []BatchItem{{Target: "a"}, {Target: "b"}})
	require.NoError(t, err)
	require.Len(t, got, 2)
	assert.Equal(t, "req-1", got[0].ID)
	assert.NoError(t, got[0].Err)
	assert.ErrorContains(t, got[1].Err, "queue_full")
}

func TestSubmitBatch_AllRejectedStillReportsItems(t *testing.T) {
	c := batchAnswer(t, http.StatusBadRequest, `{"items": [{"error": {"code": "unknown_target", "message": "no"}}]}`)
	got, err := c.SubmitBatch(context.Background(), []BatchItem{{Target: "a"}})
	require.NoError(t, err)
	assert.ErrorContains(t, got[0].Err, "unknown_target")
}

func TestSubmitBatch_Rejects(t *testing.T) {
	c := batchAnswer(t, http.StatusAccepted, `{"items": [{"id": "req-1"}]}`)
	_, err := c.SubmitBatch(context.Background(), []BatchItem{{Target: "a"}, {Target: "b"}})
	assert.ErrorContains(t, err, "2 items sent, 1 answered")

	rejected := batchAnswer(t, http.StatusBadRequest, `{"error": {"code": "invalid_parameter", "message": "requests must hold between 1 and 100 items"}}`)
	_, err = rejected.SubmitBatch(context.Background(), []BatchItem{{Target: "a"}})
	assert.ErrorContains(t, err, "requests must hold between 1 and 100 items")

	_, err = c.SubmitBatch(context.Background(), nil)
	assert.Error(t, err)
	_, err = c.SubmitBatch(context.Background(), make([]BatchItem, 101))
	assert.Error(t, err)
}
