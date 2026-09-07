package tentacron

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestDo_submitThenLongPollToCompleted(t *testing.T) {
	pollBackstop = time.Millisecond
	t.Cleanup(func() { pollBackstop = time.Second })

	var polls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/requests":
			assert.Equal(t, "test-key", r.Header.Get("X-API-Key"))
			var body submitRequest
			require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
			assert.Equal(t, "ignis-calculate", body.Target)
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"req-9","state":"received"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/requests/req-9":
			assert.Equal(t, waitParam, r.URL.Query().Get("wait"))
			if polls.Add(1) == 1 {
				_, _ = w.Write([]byte(`{"state":"forwarding"}`))
				return
			}
			_, _ = w.Write([]byte(`{"state":"completed","result":{"target_status":200,"target_response":{"q_h_nd":42.5}}}`))
		default:
			t.Fatalf("unexpected %s %s", r.Method, r.URL)
		}
	}))
	defer srv.Close()

	var out struct {
		QHND float64 `json:"q_h_nd"`
	}
	err := New(srv.URL, "test-key").Do(context.Background(), "ignis-calculate", map[string]any{"code": "X"}, &out)

	require.NoError(t, err)
	assert.Equal(t, 42.5, out.QHND)
	assert.EqualValues(t, 2, polls.Load())
}

func TestDo_followsSpooledResultHref(t *testing.T) {
	// A body over TentaCron's 256 KiB inline cap comes back as result.href with
	// no target_response; the client must follow the href to get the full body.
	big := make([]float64, 40_000) // ~280 KiB as JSON
	for i := range big {
		big[i] = float64(i) + 0.5
	}
	payload, _ := json.Marshal(map[string]any{"values": big})
	require.Greater(t, len(payload), 256<<10, "test body must exceed the inline cap")

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/requests":
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"req-7"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/requests/req-7":
			_, _ = w.Write([]byte(`{"state":"completed","result":{"target_status":200,"href":"/v1/requests/req-7/result","content_type":"application/json"}}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/requests/req-7/result":
			assert.Equal(t, "k", r.Header.Get("X-API-Key"))
			_, _ = w.Write(payload)
		default:
			t.Fatalf("unexpected %s %s", r.Method, r.URL)
		}
	}))
	defer srv.Close()

	var out struct {
		Values []float64 `json:"values"`
	}
	err := New(srv.URL, "k").Do(context.Background(), "weather-point", nil, &out)

	require.NoError(t, err)
	require.Len(t, out.Values, len(big))
	assert.Equal(t, big[0], out.Values[0])
	assert.Equal(t, big[len(big)-1], out.Values[len(big)-1])
}

func TestDo_completedWithNeitherBodyNorHrefIsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"req-1"}`))
			return
		}
		_, _ = w.Write([]byte(`{"state":"completed","result":{"target_status":200}}`))
	}))
	defer srv.Close()

	var out map[string]any
	err := New(srv.URL, "k").Do(context.Background(), "weather-point", nil, &out)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "neither target_response nor href")
}

func TestDo_failedStateReturnsTargetError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"req-1"}`))
			return
		}
		_, _ = w.Write([]byte(`{"state":"failed","error":{"code":"target_error","message":"target ignis-data: HTTP 404: {\"error\":\"variant not found\"}"}}`))
	}))
	defer srv.Close()

	err := New(srv.URL, "k").Do(context.Background(), "ignis-data", map[string]any{"code": "X"}, nil)

	te, ok := AsTargetError(err)
	require.True(t, ok)
	assert.Equal(t, "target_error", te.Code)
	assert.Contains(t, te.Message, "HTTP 404")
}

func TestDo_emptyRequestIDIsAnError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"state":"received"}`))
	}))
	defer srv.Close()

	err := New(srv.URL, "k").Do(context.Background(), "ignis-data", nil, nil)
	require.Error(t, err)
}

func TestDo_cancelledContext(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"req-1"}`))
			return
		}
		_, _ = w.Write([]byte(`{"state":"resolving"}`))
	}))
	defer srv.Close()

	ctx, cancel := context.WithCancel(context.Background())
	cancel()

	err := New(srv.URL, "k").Do(ctx, "ignis-data", nil, nil)
	require.Error(t, err)
}

func TestTargetError_UpstreamStatus(t *testing.T) {
	cases := []struct {
		name     string
		message  string
		wantCode int
		wantOK   bool
	}{
		{"upstream 404", `target c2t-run-status: HTTP 404: {"error":"run not found"}`, 404, true},
		{"upstream 400", `target c2t-trigger-run: HTTP 400: bad bbox`, 400, true},
		{"upstream 500", "target c2t-buildings: HTTP 500: pq: relation does not exist", 500, true},
		{"upstream 502", "target buem-buildings: HTTP 502: Bad Gateway", 502, true},
		{"timeout, no status", "target buem-buildings timed out after 570s", 0, false},
		{"caller mistake, no status", "no target named c2t-run-status", 0, false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			code, ok := (&TargetError{Code: "target_error", Message: tc.message}).UpstreamStatus()
			assert.Equal(t, tc.wantOK, ok)
			assert.Equal(t, tc.wantCode, code)
		})
	}
}

func TestDoTimeout_boundsTheWholeOperation(t *testing.T) {
	// The status GET never returns a terminal state; DoTimeout's own ceiling
	// must abort the await rather than hang.
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"req-1"}`))
			return
		}
		_, _ = w.Write([]byte(`{"state":"awaiting_target"}`))
	}))
	defer srv.Close()

	pollBackstop = time.Millisecond
	t.Cleanup(func() { pollBackstop = time.Second })

	start := time.Now()
	err := New(srv.URL, "k").DoTimeout(context.Background(), "buem-buildings", nil, nil, 80*time.Millisecond)
	require.Error(t, err)
	assert.Less(t, time.Since(start), time.Second, "DoTimeout must abort near its own ceiling, not opTimeout")
}
