package users

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"sync"
	"testing"

	"github.com/stretchr/testify/require"
	"platform.local/platform/auth"
	"spatialhub_backend/internal/bearerauth"
	"spatialhub_backend/internal/config"
)

type staticToken struct{ err error }

func (s staticToken) GetToken() (string, error) { return "admin-token", s.err }

// fakeKeycloak answers the users search by identity provider link and user
// creation; creating a user whose email is in taken returns 409.
func fakeKeycloak(t *testing.T, links map[string][]User, taken ...string) *config.Config {
	t.Helper()
	var mu sync.Mutex
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		defer mu.Unlock()
		if r.URL.Path != "/admin/realms/spatialhub/users" || r.Header.Get("Authorization") != "Bearer admin-token" {
			w.WriteHeader(http.StatusBadRequest)
			return
		}
		if r.Method == http.MethodPost {
			createUser(t, w, r, links, taken)
			return
		}
		q := r.URL.Query()
		if q.Get("idpAlias") != "renvolveit" {
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

func createUser(t *testing.T, w http.ResponseWriter, r *http.Request, links map[string][]User, taken []string) {
	var rep struct {
		Email               string              `json:"email"`
		EmailVerified       bool                `json:"emailVerified"`
		Attributes          map[string][]string `json:"attributes"`
		FederatedIdentities []struct {
			IdentityProvider string `json:"identityProvider"`
			UserID           string `json:"userId"`
		} `json:"federatedIdentities"`
	}
	require.NoError(t, json.NewDecoder(r.Body).Decode(&rep))
	if slices.Contains(taken, rep.Email) {
		w.WriteHeader(http.StatusConflict)
		return
	}
	require.True(t, rep.EmailVerified)
	require.Len(t, rep.FederatedIdentities, 1)
	require.Equal(t, "renvolveit", rep.FederatedIdentities[0].IdentityProvider)
	links[rep.FederatedIdentities[0].UserID] = []User{{ID: "new-" + rep.Email, Email: rep.Email, Enabled: true, Attributes: rep.Attributes}}
	w.WriteHeader(http.StatusCreated)
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

	got, err := accounts.Resolve(&bearerauth.Identity{Subject: "partner-a"})
	require.NoError(t, err)
	require.Equal(t, &bearerauth.Account{ID: "local-a", Email: "a@example.com", Name: "Alice A", AccessLevel: "expert"}, got)

	got, err = accounts.Resolve(&bearerauth.Identity{Subject: "partner-plain"})
	require.NoError(t, err)
	require.Equal(t, &bearerauth.Account{ID: "local-p", Email: "p@example.com", Name: "p@example.com", AccessLevel: "very_low"}, got)

	_, err = accounts.Resolve(&bearerauth.Identity{Subject: "partner-unknown"})
	require.ErrorIs(t, err, bearerauth.ErrNotLinked)

	_, err = accounts.Resolve(&bearerauth.Identity{Subject: "partner-unverified", Email: "u@example.com"})
	require.ErrorIs(t, err, bearerauth.ErrNotLinked, "an unverified email must not create an account")

	_, err = accounts.Resolve(&bearerauth.Identity{Subject: "partner-disabled"})
	require.ErrorIs(t, err, bearerauth.ErrDisabled)

	_, err = accounts.Resolve(&bearerauth.Identity{Subject: "partner-twice"})
	require.ErrorContains(t, err, "2 users linked to renvolveit user partner-twice")

	_, err = NewPartnerAccounts(cfg, staticToken{err: errors.New("keycloak down")}).Resolve(&bearerauth.Identity{Subject: "partner-a"})
	require.ErrorContains(t, err, "keycloak down")
}

func TestPartnerAccountsCreateOnFirstUse(t *testing.T) {
	cfg := fakeKeycloak(t, map[string][]User{}, "taken@example.com")
	accounts := NewPartnerAccounts(cfg, staticToken{})

	got, err := accounts.Resolve(&bearerauth.Identity{Subject: "partner-new", Email: "new@example.com", EmailVerified: true, Name: "New Member"})
	require.NoError(t, err)
	require.Equal(t, &bearerauth.Account{ID: "new-new@example.com", Email: "new@example.com", Name: "New Member", AccessLevel: "very_low"}, got)

	again, err := accounts.Resolve(&bearerauth.Identity{Subject: "partner-new", Email: "new@example.com", EmailVerified: true})
	require.NoError(t, err)
	require.Equal(t, got, again, "the second call finds the linked account")

	_, err = accounts.Resolve(&bearerauth.Identity{Subject: "partner-other", Email: "taken@example.com", EmailVerified: true})
	require.ErrorIs(t, err, bearerauth.ErrEmailInUse)
}
