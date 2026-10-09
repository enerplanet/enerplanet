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

func TestSubmitMeme_setsIdempotencyKeyAndReturnsJobID(t *testing.T) {
	var gotKey string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.URL.Path != "/v1/requests" {
			t.Fatalf("unexpected %s %s", r.Method, r.URL)
		}
		gotKey = r.Header.Get("Idempotency-Key")
		var body submitRequest
		require.NoError(t, json.NewDecoder(r.Body).Decode(&body))
		require.Equal(t, "meme", body.Target)
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"id":"job-42","state":"received"}`))
	}))
	defer srv.Close()

	id, err := New(srv.URL, "k").SubmitMeme(context.Background(), "meme", map[string]any{"model": "m"}, "model_42")

	require.NoError(t, err)
	require.Equal(t, "job-42", id, "submit returns the job id")
	require.Equal(t, "model_42", gotKey, "Idempotency-Key is set on the POST")
}

func TestSubmitMeme_partialResponseNoIDIsError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusAccepted)
		_, _ = w.Write([]byte(`{"state":"received"}`))
	}))
	defer srv.Close()

	_, err := New(srv.URL, "k").SubmitMeme(context.Background(), "meme", map[string]any{}, "k1")
	require.Error(t, err)
}

func TestAwaitResultByID_resumesNoResubmit(t *testing.T) {
	// A dispatch that already has a job id must resume by id (GET status /
	// GET result) and never POST /v1/requests again.
	pollBackstop = time.Millisecond
	t.Cleanup(func() { pollBackstop = time.Second })

	var posts atomic.Int32
	zipBody := []byte("PK\x03\x04resume-zip\x00\xff")
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/requests":
			posts.Add(1)
			t.Fatalf("resume-by-id must not resubmit")
		case r.Method == http.MethodGet && r.URL.Path == "/v1/requests/job-9":
			_, _ = w.Write([]byte(`{"state":"completed","result":{"target_status":200,"href":"/v1/requests/job-9/result","content_type":"application/zip"}}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/requests/job-9/result":
			_, _ = w.Write(zipBody)
		default:
			t.Fatalf("unexpected %s %s", r.Method, r.URL)
		}
	}))
	defer srv.Close()

	c := New(srv.URL, "k")
	require.NoError(t, c.AwaitResultByID(context.Background(), "job-9", time.Minute))
	got, err := c.FetchResultByID(context.Background(), "job-9")

	require.NoError(t, err)
	require.Equal(t, zipBody, got, "the raw zip is fetched verbatim via /result")
	assert.Zero(t, posts.Load(), "no resubmission during resume-by-id")
}

func TestAwaitResultByID_failedStateReturnsTargetError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			t.Fatalf("resume-by-id must not resubmit")
		}
		_, _ = w.Write([]byte(`{"state":"failed","error":{"code":"target_error","message":"target meme: HTTP 500: boom"}}`))
	}))
	defer srv.Close()

	err := New(srv.URL, "k").AwaitResultByID(context.Background(), "job-f", time.Minute)
	require.Error(t, err)
	te, ok := AsTargetError(err)
	require.True(t, ok)
	assert.Equal(t, "target_error", te.Code)
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
