package users

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/require"
	"platform.local/platform/auth"
	"spatialhub_backend/internal/bearerauth"
	"spatialhub_backend/internal/config"
)

type staticToken struct{ err error }

func (s staticToken) GetToken() (string, error) { return "admin-token", s.err }

// fakeKeycloak answers the users search by identity provider link.
func fakeKeycloak(t *testing.T, links map[string][]User) *config.Config {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		q := r.URL.Query()
		if r.URL.Path != "/admin/realms/spatialhub/users" || q.Get("idpAlias") != "renvolveit" ||
			r.Header.Get("Authorization") != "Bearer admin-token" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		users := links[q.Get("idpUserId")]
		if users == nil {
			users = []User{}
		}
		require.NoError(t, json.NewEncoder(w).Encode(users))
	}))
	t.Cleanup(server.Close)
	return &config.Config{
		Auth:       auth.Config{BaseURL: server.URL, Realm: "spatialhub"},
		BearerAuth: bearerauth.Options{IdentityProvider: "renvolveit"},
	}
}

func TestPartnerAccountsResolve(t *testing.T) {
	cfg := fakeKeycloak(t, map[string][]User{
		"partner-a": {{ID: "local-a", Email: "a@example.com", Enabled: true,
			Attributes: map[string][]string{"fullName": {"Alice A"}, "access_level": {"expert"}}}},
		"partner-plain":    {{ID: "local-p", Email: "p@example.com", Enabled: true}},
		"partner-disabled": {{ID: "local-d", Enabled: false}},
		"partner-twice":    {{ID: "one", Enabled: true}, {ID: "two", Enabled: true}},
	})
	accounts := NewPartnerAccounts(cfg, staticToken{})

	got, err := accounts.Resolve("partner-a")
	require.NoError(t, err)
	require.Equal(t, &bearerauth.Account{ID: "local-a", Email: "a@example.com", Name: "Alice A", AccessLevel: "expert"}, got)

	got, err = accounts.Resolve("partner-plain")
	require.NoError(t, err)
	require.Equal(t, &bearerauth.Account{ID: "local-p", Email: "p@example.com", Name: "p@example.com", AccessLevel: "very_low"}, got)

	_, err = accounts.Resolve("partner-unknown")
	require.ErrorIs(t, err, bearerauth.ErrNotLinked)

	_, err = accounts.Resolve("partner-disabled")
	require.ErrorIs(t, err, bearerauth.ErrDisabled)

	_, err = accounts.Resolve("partner-twice")
	require.ErrorContains(t, err, "2 users linked to renvolveit user partner-twice")

	_, err = NewPartnerAccounts(cfg, staticToken{err: errors.New("keycloak down")}).Resolve("partner-a")
	require.ErrorContains(t, err, "keycloak down")
}
