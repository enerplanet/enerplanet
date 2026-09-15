package jobs

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	commonModels "platform.local/common/pkg/models"
	"spatialhub_backend/internal/city2tabula"
	"spatialhub_backend/internal/payload"
	"spatialhub_backend/internal/tentacron"
	"spatialhub_backend/internal/weather"
)

// fakeTentacron serves both the City2TABULA and weather-serve targets from one
// stub, so a test can resolve an envelope while weather fails.
func fakeTentacron(t *testing.T, respond func(target string) (int, string)) string {
	t.Helper()
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/requests":
			var req struct {
				Target string `json:"target"`
			}
			require.NoError(t, json.NewDecoder(r.Body).Decode(&req))
			w.WriteHeader(http.StatusAccepted)
			_, _ = w.Write([]byte(`{"id":"` + req.Target + `"}`))
		case r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/v1/requests/"):
			target := strings.TrimPrefix(r.URL.Path, "/v1/requests/")
			status, body := respond(target)
			if status >= 200 && status < 300 {
				_, _ = w.Write([]byte(`{"state":"completed","result":{"target_status":200,"target_response":` + body + `}}`))
				return
			}
			_, _ = w.Write([]byte(`{"state":"failed","error":{"code":"target_error","message":"target ` + target + `: HTTP 500: ` + body + `"}}`))
		default:
			t.Fatalf("unexpected %s %s", r.Method, r.URL)
		}
	}))
	t.Cleanup(srv.Close)
	return srv.URL
}

// TestResolveBuemForModel_WeatherFailureIsNotAttributedToBuem covers a building
// whose envelope resolved but whose area has no weather archive. BuEM is never
// called, so the building belongs in unresolved with the real reason. Returned
// in resolved with no result instead, the demand-profile job stores "BuEM
// rejected this building" against a service that was never asked, which is
// what this asserts against.
func TestResolveBuemForModel_WeatherFailureIsNotAttributedToBuem(t *testing.T) {
	url := fakeTentacron(t, func(target string) (int, string) {
		if target == "weather-point" {
			return 500, "no archive for this area"
		}
		return 200, `[{"object_id":"O1","osm_id":"111","match_type":1,"footprint_area":80,` +
			`"number_of_storeys":2,"room_height":2.5,"tabula_variant_code":"NL.N.SFH.05.Gen",` +
			`"surfaces":[{"id":"w1","type":"WallSurface","area":30,"azimuth":180,"tilt":0}]}]`
	})
	country := "netherlands"
	model := commonModels.Model{
		ID:          1,
		Country:     &country,
		Coordinates: []byte(`{"type":"Polygon","coordinates":[[[6.0,52.0],[6.1,52.0],[6.1,52.1],[6.0,52.1],[6.0,52.0]]]}`),
		FromDate:    time.Date(2018, 1, 1, 0, 0, 0, 0, time.UTC),
	}
	p := payload.CalculationPayload{Topology: topologyBuildings("111")}

	results, resolved, unresolved, err := ResolveBuemForModel(
		context.Background(), logrus.NewEntry(logrus.New()),
		city2tabula.NewClient(tentacron.New(url, "k")), &fakeRunStore{},
		weather.NewClient(tentacron.New(url, "k")), "cosmo-rea6",
		fakeEnvelopeUValueResolver{code: "NL.N.SFH.05.Gen"}, nil,
		model, p, "existing",
	)

	require.NoError(t, err, "a missing weather archive is not a job failure")
	assert.Empty(t, results, "buem-gateway is not called without weather")
	assert.NotContains(t, resolved, "111",
		"a building BuEM never saw must not be reported as resolved")
	require.Contains(t, unresolved, "111",
		"the building must carry a reason, per ResolveBuemForModel's own contract")
	assert.NotContains(t, strings.ToLower(unresolved["111"]), "buem",
		"the reason must name the real cause, not a service that was never called")
}
