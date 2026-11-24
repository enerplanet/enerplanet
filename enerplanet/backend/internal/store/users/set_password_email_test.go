package users

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"testing"

	"github.com/stretchr/testify/require"
	"platform.local/platform/auth"
	"spatialhub_backend/internal/config"
)

// fake keycloak endpoint
func fakeActionsEmail(t *testing.T, respond func(q url.Values) (int, string)) (*config.Config, *[]url.Values) {
	t.Helper()
	var calls []url.Values
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		require.Equal(t, http.MethodPut, r.Method)
		require.Equal(t, "/admin/realms/spatialhub/users/user-1/execute-actions-email", r.URL.Path)
		require.Equal(t, "Bearer admin-token", r.Header.Get("Authorization"))
		require.Equal(t, "application/json", r.Header.Get("Content-Type"))
		raw, err := io.ReadAll(r.Body)
		require.NoError(t, err)
		var actions []string
		require.NoError(t, json.Unmarshal(raw, &actions))
		require.Equal(t, []string{"UPDATE_PASSWORD"}, actions)

		q := r.URL.Query()
		calls = append(calls, q)
		status, body := respond(q)
		w.WriteHeader(status)
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(server.Close)
	return &config.Config{
		AppURL: "https://app.example.com/",
		Auth:   auth.Config{BaseURL: server.URL, Realm: "spatialhub", ClientID: "spatialhub-app"},
	}, &calls
}

func TestSendSetPasswordEmailRequest(t *testing.T) {
	cfg, calls := fakeActionsEmail(t, func(url.Values) (int, string) { return http.StatusNoContent, "" })

	require.NoError(t, New(cfg).SendSetPasswordEmail("admin-token", "user-1"))

	require.Len(t, *calls, 1)
	q := (*calls)[0]
	require.Equal(t, "259200", q.Get("lifespan"))
	require.Equal(t, "spatialhub-app", q.Get("client_id"))
	require.Equal(t, "https://app.example.com/login", q.Get("redirect_uri"))
}

func TestSendSetPasswordEmailWithoutAppURL(t *testing.T) {
	cfg, calls := fakeActionsEmail(t, func(url.Values) (int, string) { return http.StatusNoContent, "" })
	cfg.AppURL = ""

	require.NoError(t, New(cfg).SendSetPasswordEmail("admin-token", "user-1"))

	require.Len(t, *calls, 1)
	require.False(t, (*calls)[0].Has("client_id"))
	require.False(t, (*calls)[0].Has("redirect_uri"))
}

func TestSendSetPasswordEmailRetriesWithoutRejectedRedirect(t *testing.T) {
	cfg, calls := fakeActionsEmail(t, func(q url.Values) (int, string) {
		if q.Has("redirect_uri") {
			return http.StatusBadRequest, `{"errorMessage":"Invalid redirect uri."}`
		}
		return http.StatusNoContent, ""
	})

	require.NoError(t, New(cfg).SendSetPasswordEmail("admin-token", "user-1"))

	require.Len(t, *calls, 2)
	require.True(t, (*calls)[0].Has("redirect_uri"))
	require.False(t, (*calls)[1].Has("redirect_uri"))
	require.False(t, (*calls)[1].Has("client_id"))
	require.Equal(t, "259200", (*calls)[1].Get("lifespan"))
}

func TestSendSetPasswordEmailNoRetryOnOtherErrors(t *testing.T) {
	cases := map[string]struct {
		status int
		body   string
	}{
		"other bad request":      {http.StatusBadRequest, `{"errorMessage":"User email missing"}`},
		"redirect text, not 400": {http.StatusInternalServerError, `{"error":"failed to follow redirect"}`},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			cfg, calls := fakeActionsEmail(t, func(url.Values) (int, string) { return tc.status, tc.body })

			err := New(cfg).SendSetPasswordEmail("admin-token", "user-1")

			require.Error(t, err)
			require.NotErrorIs(t, err, errRedirectRejected)
			require.Len(t, *calls, 1)
		})
	}
}
