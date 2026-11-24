package middleware

import (
	"errors"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
	"spatialhub_backend/internal/apitoken"
	"spatialhub_backend/internal/bearerauth"
	"spatialhub_backend/internal/models"
	"spatialhub_backend/internal/testutil"
)

type personalTokenValidator struct{}

func (personalTokenValidator) Validate(raw string) (*models.APIToken, error) {
	if raw != "whf_valid" {
		return nil, apitoken.ErrInvalid
	}
	return &models.APIToken{UserID: "pat-user", UserEmail: "pat@example.com", AccessLevel: "intermediate", Scope: "read"}, nil
}

// Stands in for the Keycloak identity provider link lookup.
type partnerAccounts struct{ calls atomic.Int32 }

func (p *partnerAccounts) Resolve(id *bearerauth.Identity) (*bearerauth.Account, error) {
	p.calls.Add(1)
	switch id.Subject {
	case "partner-a":
		return &bearerauth.Account{ID: "local-a", Email: "a@example.com", Name: "A", AccessLevel: "expert"}, nil
	case "partner-disabled":
		return nil, bearerauth.ErrDisabled
	case "partner-down":
		return nil, errors.New("keycloak unreachable")
	case "partner-taken":
		return nil, bearerauth.ErrEmailInUse
	}
	return nil, bearerauth.ErrNotLinked
}

func TestBearerAuthenticationChain(t *testing.T) {
	gin.SetMode(gin.TestMode)
	f := testutil.NewOIDCFixture(t)
	v, err := bearerauth.New(bearerauth.Options{Issuer: f.Issuer, Audience: "enerplanet", ClientID: "toolbox", IdentityProvider: "renvolveit", CacheTTL: time.Minute, AllowHTTP: true})
	require.NoError(t, err)
	accounts := &partnerAccounts{}
	var authCalls atomic.Int32
	authService := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		authCalls.Add(1)
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"success":true,"user":{"id":"session-user","email":"session@example.com","access_level":"intermediate"}}`))
	}))
	defer authService.Close()
	router := gin.New()
	router.Use(APITokenAuth(personalTokenValidator{}), BearerAuth(v, accounts), AuthServiceMiddleware(AuthServiceOptions{AuthServiceURL: authService.URL}))
	router.GET("/api/auth/whoami", WhoAmI())
	for _, path := range []string{"/api/models", "/api/models/:id/results", "/api/models/:id/kpis", "/api/users", "/api/models/:id/shares"} {
		router.GET(path, func(c *gin.Context) { c.JSON(http.StatusOK, gin.H{"subject": c.GetString("user_id")}) })
	}
	// Production proxy route.
	router.Any("/api/webservices/*proxyPath", func(c *gin.Context) { c.Status(http.StatusOK) })
	router.POST("/api/models", func(c *gin.Context) { c.Status(http.StatusCreated) })
	raw := f.Sign(t, f.Claims("partner-a"))
	tests := []struct {
		name, method, path, header string
		cookie                     bool
		status                     int
		body                       string
	}{
		{"JWT acts as linked account", "GET", "/api/auth/whoami", "Bearer " + raw, false, 200, `"subject":"local-a"`},
		{"JWT access level capped", "GET", "/api/auth/whoami", "Bearer " + raw, false, 200, `"access_level":"intermediate"`},
		{"JWT reports partner issuer", "GET", "/api/auth/whoami", "Bearer " + raw, false, 200, `"issuer":"` + f.Issuer + `"`},
		{"case insensitive scheme", "GET", "/api/models", "bearer " + raw, false, 200, `"subject":"local-a"`},
		{"kpis", "GET", "/api/models/12/kpis", "Bearer " + raw, false, 200, "local-a"},
		{"results not open to toolbox", "GET", "/api/models/12/results", "Bearer " + raw, false, 403, "Token does not permit"},
		{"not linked", "GET", "/api/models", "Bearer " + f.Sign(t, f.Claims("partner-new")), false, 403, "No EnerPlanET account is linked"},
		{"disabled account", "GET", "/api/models", "Bearer " + f.Sign(t, f.Claims("partner-disabled")), true, 403, "account is disabled"},
		{"lookup failure", "GET", "/api/models", "Bearer " + f.Sign(t, f.Claims("partner-down")), true, 503, "Account lookup unavailable"},
		{"email of an unlinked account", "GET", "/api/models", "Bearer " + f.Sign(t, f.Claims("partner-taken")), true, 403, "already uses this email"},
		{"writes forbidden", "POST", "/api/models", "Bearer " + raw, true, 403, "Token does not permit"},
		{"admin forbidden", "GET", "/api/users", "Bearer " + raw, true, 403, "Token does not permit"},
		{"unlisted model route", "GET", "/api/models/12/shares", "Bearer " + raw, false, 403, "Token does not permit"},
		{"malformed", "GET", "/api/models", "Bearer garbage", false, 401, "Unrecognised bearer token"},
		{"no cookie fallback", "GET", "/api/models", "Bearer garbage", true, 401, "Unrecognised bearer token"},
		{"missing bearer value", "GET", "/api/models", "Bearer", true, 401, "Unrecognised bearer token"},
		{"extra value", "GET", "/api/models", "Bearer a b", false, 401, "Unrecognised bearer token"},
		{"personal token", "GET", "/api/auth/whoami", "Bearer whf_valid", false, 200, `"authentication_method":"api_token"`},
		{"bad personal token", "GET", "/api/models", "Bearer whf_bad", true, 401, "Invalid API token"},
		{"read personal token write", "POST", "/api/models", "Bearer whf_valid", false, 403, "This API token is read-only"},
		{"browser session", "GET", "/api/auth/whoami", "", true, 200, `"subject":"session-user"`},
		{"browser session has no issuer", "GET", "/api/auth/whoami", "", true, 200, `{"subject":"session-user"`},
		{"anonymous health", "GET", "/api/webservices/health", "", false, 200, ""},
		{"health with JWT", "GET", "/api/webservices/health", "Bearer " + raw, false, 200, ""},
		{"health with garbage bearer", "GET", "/api/webservices/health", "Bearer garbage", false, 200, ""},
		{"health with personal token", "GET", "/api/webservices/health", "Bearer whf_valid", false, 200, ""},
		{"personal token lowercase scheme", "GET", "/api/auth/whoami", "bearer whf_valid", false, 200, `"authentication_method":"api_token"`},
		{"other proxied path with JWT", "GET", "/api/webservices/models", "Bearer " + raw, false, 403, "Token does not permit"},
		{"anonymous private", "GET", "/api/models", "", false, 401, "Session not found"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			callsBefore := authCalls.Load()
			req := httptest.NewRequest(tt.method, tt.path, nil)
			if tt.header != "" {
				req.Header.Set("Authorization", tt.header)
			}
			if tt.cookie {
				req.AddCookie(&http.Cookie{Name: "session_id", Value: "session"})
			}
			w := httptest.NewRecorder()
			router.ServeHTTP(w, req)
			require.Equal(t, tt.status, w.Code, w.Body.String())
			require.Contains(t, w.Body.String(), tt.body)
			if tt.header != "" {
				require.Equal(t, callsBefore, authCalls.Load(), "bearer must never fall through to session validation")
				require.Empty(t, w.Header().Values("Set-Cookie"))
			}
		})
	}
	// One credential only.
	for _, pair := range [][2]string{{"Bearer " + raw, "Bearer " + raw}, {"Bearer whf_valid", "Bearer " + raw}, {"Bearer " + raw, "Bearer whf_valid"}} {
		req := httptest.NewRequest("GET", "/api/models", nil)
		req.Header.Add("Authorization", pair[0])
		req.Header.Add("Authorization", pair[1])
		w := httptest.NewRecorder()
		router.ServeHTTP(w, req)
		require.Equal(t, 401, w.Code, pair[0][:12]+" then "+pair[1][:12])
	}
	req := httptest.NewRequest("GET", "/api/models", nil)
	req.Header.Add("Authorization", "Bearer "+raw)
	req.Header.Add("Authorization", "Bearer "+raw)
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	require.Equal(t, 401, w.Code)
	// Reject duplicate credentials.
	req.Header.Set("Authorization", "Basic unrelated")
	req.Header.Add("Authorization", "Bearer "+raw)
	req.AddCookie(&http.Cookie{Name: "session_id", Value: "session"})
	w = httptest.NewRecorder()
	callsBefore := authCalls.Load()
	router.ServeHTTP(w, req)
	require.Equal(t, 401, w.Code)
	require.Equal(t, callsBefore, authCalls.Load())
}

func TestUnconfiguredBearerAuthRejectsJWT(t *testing.T) {
	var verifier *bearerauth.Verifier
	router := gin.New()
	router.Use(BearerAuth(verifier, &partnerAccounts{}))
	router.GET("/api/models", func(c *gin.Context) { t.Fatal("invalid JWT reached handler") })
	req := httptest.NewRequest("GET", "/api/models", nil)
	req.Header.Set("Authorization", "Bearer any")
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	require.Equal(t, 401, w.Code)
}

func TestForbiddenRouteSkipsAccountLookup(t *testing.T) {
	f := testutil.NewOIDCFixture(t)
	v, err := bearerauth.New(bearerauth.Options{Issuer: f.Issuer, Audience: "enerplanet", ClientID: "toolbox", IdentityProvider: "renvolveit", CacheTTL: time.Minute, AllowHTTP: true})
	require.NoError(t, err)
	accounts := &partnerAccounts{}
	router := gin.New()
	router.Use(BearerAuth(v, accounts))
	router.GET("/api/users", func(c *gin.Context) { t.Fatal("forbidden route reached handler") })
	req := httptest.NewRequest("GET", "/api/users", nil)
	req.Header.Set("Authorization", "Bearer "+f.Sign(t, f.Claims("partner-a")))
	w := httptest.NewRecorder()
	router.ServeHTTP(w, req)
	require.Equal(t, 403, w.Code)
	require.Zero(t, accounts.calls.Load())
}

func TestToolboxAccessLevel(t *testing.T) {
	for in, want := range map[string]string{"": "very_low", "very_low": "very_low", "intermediate": "intermediate",
		"manager": "intermediate", "expert": "intermediate", "admin": "very_low"} {
		require.Equal(t, want, toolboxAccessLevel(in), in)
	}
}
