package ignis

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"spatialhub_backend/internal/tentacron"
)

func init() { gin.SetMode(gin.TestMode) }

// tentacronStub speaks the minimal TentaCron request/poll protocol and records
// the last submit so a test can assert the target and payload.
type tentacronStub struct {
	*httptest.Server
	lastTarget  string
	lastPayload map[string]any
	terminal    string
}

func newTentacronStub(t *testing.T, terminal string) *tentacronStub {
	t.Helper()
	s := &tentacronStub{terminal: terminal}
	s.Server = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/requests":
			var body struct {
				Target  string         `json:"target"`
				Payload map[string]any `json:"payload"`
			}
			_ = json.NewDecoder(r.Body).Decode(&body)
			s.lastTarget, s.lastPayload = body.Target, body.Payload
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"req-1","state":"received"}`))
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/v1/requests/"):
			_, _ = w.Write([]byte(s.terminal))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(s.Close)
	return s
}

func completed(targetResponse string) string {
	return `{"state":"completed","result":{"target_status":200,"target_response":` + targetResponse + `}}`
}

func failed(code, message string) string {
	b, _ := json.Marshal(map[string]any{"state": "failed", "error": map[string]string{"code": code, "message": message}})
	return string(b)
}

func newRouter(stub *tentacronStub) *gin.Engine {
	h := NewIgnisHandler(tentacron.New(stub.URL, "test-key"))
	r := gin.New()
	r.GET("/v2/ignis/variants/:country_iso2", h.GetVariants)
	r.GET("/v2/ignis/fields", h.GetFieldMetadata)
	return r
}

func do(r *gin.Engine, path string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	r.ServeHTTP(w, httptest.NewRequest(http.MethodGet, path, nil))
	return w
}

func TestGetVariants_sendsIso2AndWrapsResponse(t *testing.T) {
	stub := newTentacronStub(t, completed(`{"country":"germany","data":["DE.N.SFH.01.Gen","DE.N.MFH.03.Gen"]}`))

	w := do(newRouter(stub), "/v2/ignis/variants/DE")

	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "ignis-variants", stub.lastTarget)
	assert.Equal(t, "DE", stub.lastPayload["iso2"])

	// {success:true, data:<verbatim ignis body>} - the frontend reads .data.data
	var env struct {
		Success bool `json:"success"`
		Data    struct {
			Country string   `json:"country"`
			Data    []string `json:"data"`
		} `json:"data"`
	}
	require.NoError(t, json.Unmarshal(w.Body.Bytes(), &env))
	assert.True(t, env.Success)
	assert.Equal(t, "germany", env.Data.Country)
	assert.Equal(t, []string{"DE.N.SFH.01.Gen", "DE.N.MFH.03.Gen"}, env.Data.Data)
}

func TestGetFieldMetadata_sendsEmptyPayloadAndWraps(t *testing.T) {
	stub := newTentacronStub(t, completed(`{"data":[{"key":"A_C_Ref_Input","label":"Reference floor area","unit":"m2"}]}`))

	w := do(newRouter(stub), "/v2/ignis/fields")

	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "ignis-fields", stub.lastTarget)
	assert.Empty(t, stub.lastPayload)
	assert.Contains(t, w.Body.String(), `"A_C_Ref_Input"`)
}

func TestGetVariants_ignisRejectionIs400WithMessage(t *testing.T) {
	stub := newTentacronStub(t, failed("target_error",
		`target ignis-variants: HTTP 400: {"error":"country ZZ is not supported"}`))

	w := do(newRouter(stub), "/v2/ignis/variants/ZZ")

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "country ZZ is not supported")
}

func TestGetVariants_infrastructureFaultIs502(t *testing.T) {
	stub := newTentacronStub(t, failed("max_attempts_exceeded", "ignis unreachable after 5 attempts"))

	w := do(newRouter(stub), "/v2/ignis/variants/DE")

	assert.Equal(t, http.StatusBadGateway, w.Code)
}
