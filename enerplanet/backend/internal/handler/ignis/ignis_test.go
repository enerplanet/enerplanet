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
	r.GET("/v2/ignis/variants/:country_iso2/match", h.MatchVariants)
	r.GET("/v2/ignis/data/:code", h.GetVariantData)
	r.POST("/v2/ignis/calculate/:code", h.Calculate)
	return r
}

// post sends a JSON body, or no body at all when body is "".
func post(r *gin.Engine, path, body string) *httptest.ResponseRecorder {
	w := httptest.NewRecorder()
	var req *http.Request
	if body == "" {
		req = httptest.NewRequest(http.MethodPost, path, nil)
	} else {
		req = httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
		req.Header.Set("Content-Type", "application/json")
	}
	r.ServeHTTP(w, req)
	return w
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

// An ignis rejection keeps its 400, so the caller still learns the request was
// refused rather than that ignis was down. Ignis's own text can name internal
// storage, so it goes to the log and not into the response.
func TestGetVariants_ignisRejectionIs400WithoutUpstreamText(t *testing.T) {
	stub := newTentacronStub(t, failed("target_error",
		`target ignis-variants: HTTP 400: {"error":"country ZZ is not supported"}`))

	w := do(newRouter(stub), "/v2/ignis/variants/ZZ")

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), ignisRejectedMessage)
	assert.NotContains(t, w.Body.String(), "country ZZ is not supported")
}

func TestGetVariants_infrastructureFaultIs502(t *testing.T) {
	stub := newTentacronStub(t, failed("max_attempts_exceeded", "ignis unreachable after 5 attempts"))

	w := do(newRouter(stub), "/v2/ignis/variants/DE")

	assert.Equal(t, http.StatusBadGateway, w.Code)
}

func TestMatchVariants_sendsTypeAndYearAlongsideIso2(t *testing.T) {
	stub := newTentacronStub(t, completed(`{"data":[{"code":"NL.N.SFH.05.Gen.ReEx.001.001","label":"Existing state"}]}`))

	w := do(newRouter(stub), "/v2/ignis/variants/NL/match?type=SFH&year=1975")

	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "ignis-variants-match", stub.lastTarget)
	assert.Equal(t, "NL", stub.lastPayload["iso2"])
	assert.Equal(t, "SFH", stub.lastPayload["type"])
	assert.Equal(t, float64(1975), stub.lastPayload["year"], "year reaches ignis as a number, not the query string")
}

func TestMatchVariants_rejectsANonNumericYear(t *testing.T) {
	stub := newTentacronStub(t, completed(`{}`))

	w := do(newRouter(stub), "/v2/ignis/variants/NL/match?type=SFH&year=recently")

	assert.Equal(t, http.StatusBadRequest, w.Code)
	assert.Contains(t, w.Body.String(), "recently", "the rejected value belongs in the message")
	assert.Empty(t, stub.lastTarget, "nothing should reach ignis")
}

func TestGetVariantData_sendsTheCode(t *testing.T) {
	stub := newTentacronStub(t, completed(`{"tabula_data":{"BasicParameters":{}}}`))

	w := do(newRouter(stub), "/v2/ignis/data/NL.N.SFH.05.Gen.ReEx.001.001")

	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "ignis-data", stub.lastTarget)
	assert.Equal(t, "NL.N.SFH.05.Gen.ReEx.001.001", stub.lastPayload["code"])
}

func TestCalculate_forwardsOverridesAndPinsTheCodeToThePath(t *testing.T) {
	stub := newTentacronStub(t, completed(`{"q_h_nd":123.4}`))

	w := post(newRouter(stub), "/v2/ignis/calculate/NL.N.SFH.05.Gen.ReEx.001.001",
		`{"U_Actual_Wall_1":0.18,"code":"DE.N.MFH.09.Gen.ReEx.001.001"}`)

	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, "ignis-calculate", stub.lastTarget)
	assert.Equal(t, 0.18, stub.lastPayload["U_Actual_Wall_1"])
	assert.Equal(t, "NL.N.SFH.05.Gen.ReEx.001.001", stub.lastPayload["code"],
		"the path wins, so a body cannot redirect the call at another variant")
}

func TestCalculate_emptyBodyRunsTheArchetypeUnmodified(t *testing.T) {
	stub := newTentacronStub(t, completed(`{"q_h_nd":99}`))

	w := post(newRouter(stub), "/v2/ignis/calculate/NL.N.SFH.05.Gen.ReEx.001.001", "")

	require.Equal(t, http.StatusOK, w.Code)
	assert.Equal(t, map[string]any{"code": "NL.N.SFH.05.Gen.ReEx.001.001"}, stub.lastPayload)
}
