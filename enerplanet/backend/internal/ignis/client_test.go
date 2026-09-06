package ignis

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"spatialhub_backend/internal/tentacron"
)

// tentacronStub speaks the minimal TentaCron request/poll protocol so the
// ignis client can be exercised without a live TentaCron or ignis. It records
// the last submit so a test can assert the target name and payload.
type tentacronStub struct {
	*httptest.Server
	lastTarget  string
	lastPayload map[string]any
	terminal    string // the poll response body returned for any request id
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
			s.lastTarget = body.Target
			s.lastPayload = body.Payload
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"req-1","state":"received"}`))
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/v1/requests/"):
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(s.terminal))
		default:
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(s.Close)
	return s
}

func stubClient(s *tentacronStub) *Client {
	return NewClient(tentacron.New(s.URL, "test-key"))
}

func completed(targetResponse string) string {
	return `{"state":"completed","result":{"target_status":200,"target_response":` + targetResponse + `}}`
}

func failed(code, message string) string {
	b, _ := json.Marshal(map[string]any{
		"state": "failed",
		"error": map[string]string{"code": code, "message": message},
	})
	return string(b)
}

func TestISO2ForCountry(t *testing.T) {
	code, ok := ISO2ForCountry("germany")
	require.True(t, ok)
	assert.Equal(t, "DE", code)

	code, ok = ISO2ForCountry("UK")
	require.True(t, ok)
	assert.Equal(t, "GB", code)

	_, ok = ISO2ForCountry("atlantis")
	assert.False(t, ok)
}

func TestMatchVariants_sendsIso2TypeYearToTarget(t *testing.T) {
	stub := newTentacronStub(t, completed(
		`{"country":"germany","prefix":"DE.N.SFH.05","data":[{"code":"DE.N.SFH.05.Gen","label":"Existing state"}]}`))

	matches, err := stubClient(stub).MatchVariants(context.Background(), "DE", "SFH", 1975)

	require.NoError(t, err)
	require.Len(t, matches, 1)
	assert.Equal(t, "DE.N.SFH.05.Gen", matches[0].Code)
	assert.Equal(t, "ignis-variants-match", stub.lastTarget)
	assert.Equal(t, "DE", stub.lastPayload["iso2"])
	assert.Equal(t, "SFH", stub.lastPayload["type"])
	assert.EqualValues(t, 1975, stub.lastPayload["year"])
}

func TestExistingStateVariant_emptyDataIsErrNoVariant(t *testing.T) {
	stub := newTentacronStub(t, completed(`{"country":"germany","prefix":"DE.N.SFH.99","data":[]}`))

	_, err := stubClient(stub).ExistingStateVariant(context.Background(), "DE", "SFH", 1000)

	assert.ErrorIs(t, err, ErrNoVariant)
}

func TestMatchVariants_ignisRejectionBecomesBadRequestError(t *testing.T) {
	stub := newTentacronStub(t, failed("target_error",
		`target ignis-variants-match: HTTP 400: {"error":"query params 'type' and 'period' are required"}`))

	_, err := stubClient(stub).MatchVariants(context.Background(), "DE", "", 1975)

	var badReq *BadRequestError
	require.ErrorAs(t, err, &badReq)
	assert.Equal(t, "query params 'type' and 'period' are required", badReq.Message)
}

func TestCalculate_backendFaultCodeStaysRaw(t *testing.T) {
	stub := newTentacronStub(t, failed("unknown_target", "no target named ignis-calculate"))

	_, err := stubClient(stub).Calculate(context.Background(), "DE.N.SFH.05.Gen")

	var badReq *BadRequestError
	assert.NotErrorAs(t, err, &badReq, "a config fault must not masquerade as an ignis rejection")
	te, ok := tentacron.AsTargetError(err)
	require.True(t, ok)
	assert.Equal(t, "unknown_target", te.Code)
}

func TestGetEnvelopeUValues_extractsWallRoofFloor(t *testing.T) {
	stub := newTentacronStub(t, completed(`{
		"country": "germany",
		"tabula_data": {
			"AdvancedParameters": {
				"Uvalues": {"U_Wall_1": 1.2, "U_Roof_1": 0.9, "U_Floor_1": 1.1, "U_Window_1": 2.8}
			}
		}
	}`))

	u, err := stubClient(stub).GetEnvelopeUValues(context.Background(), "DE.N.SFH.05.Gen")

	require.NoError(t, err)
	assert.Equal(t, 1.2, u.Wall)
	assert.Equal(t, 0.9, u.Roof)
	assert.Equal(t, 1.1, u.Floor)
	assert.Equal(t, "ignis-data", stub.lastTarget)
	assert.Equal(t, "DE.N.SFH.05.Gen", stub.lastPayload["code"])
}

func TestCalculate_sendsCodeInPayload(t *testing.T) {
	stub := newTentacronStub(t, completed(`{"variant_code":"DE.N.SFH.05.Gen","q_h_nd":100.5,"unit":"kWh/(m2.a)"}`))

	result, err := stubClient(stub).Calculate(context.Background(), "DE.N.SFH.05.Gen")

	require.NoError(t, err)
	assert.Equal(t, 100.5, result.QHNDKwhM2a)
	assert.Equal(t, "ignis-calculate", stub.lastTarget)
	assert.Equal(t, "DE.N.SFH.05.Gen", stub.lastPayload["code"])
}
