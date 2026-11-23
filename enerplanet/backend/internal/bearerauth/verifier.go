// Partner identity provider access token verification.
package bearerauth

import (
	"context"
	"crypto"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/go-jose/go-jose/v4"
)

// Default lifetime ceiling.
const DefaultMaxTokenLifetime = 15 * time.Minute

// Loggable rejection reasons.
var (
	ErrUnavailable  = errors.New("unavailable")
	ErrExpired      = errors.New("expired")
	ErrInvalidToken = errors.New("invalid_token")
	ErrClaims       = errors.New("invalid_claims")
	ErrLifetime     = errors.New("lifetime_exceeded")
	ErrNotLinked    = errors.New("account_not_linked")
	ErrDisabled     = errors.New("account_disabled")
	ErrEmailInUse   = errors.New("email_in_use")
)

type Options struct {
	Issuer string
	// Optional; empty skips the audience check.
	Audience string
	ClientID string
	// Alias of the partner identity provider in the local realm, used to find
	// the local account linked to the token subject.
	IdentityProvider string
	JWKSURL          string
	CacheTTL         time.Duration
	// Lifetime ceiling.
	MaxTokenLifetime time.Duration
	AllowHTTP        bool // Development only.
}

// Validate configuration.
func (o Options) Validate() error {
	if o.Issuer == "" && o.Audience == "" && o.ClientID == "" && o.IdentityProvider == "" && o.JWKSURL == "" {
		return nil
	}
	if o.Issuer == "" || o.ClientID == "" || o.IdentityProvider == "" {
		return errors.New("bearer authentication requires issuer, toolbox client ID and identity provider alias")
	}
	if o.CacheTTL <= 0 {
		return errors.New("bearer JWKS cache TTL must be positive")
	}
	if o.MaxTokenLifetime < 0 {
		return errors.New("bearer max token lifetime must not be negative")
	}
	var origins []string
	for _, raw := range []string{o.Issuer, o.keysURL()} {
		u, err := url.Parse(raw)
		if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" ||
			(u.Scheme != "https" && !(o.AllowHTTP && u.Scheme == "http")) {
			return errors.New("bearer issuer and JWKS URL must be absolute HTTPS URLs (HTTP allowed in development)")
		}
		origins = append(origins, strings.ToLower(u.Scheme+"://"+u.Host))
	}
	// Same-origin keys.
	if origins[0] != origins[1] {
		return errors.New("bearer JWKS URL must share the issuer's origin")
	}
	return nil
}

func (o Options) keysURL() string {
	if o.JWKSURL != "" {
		return o.JWKSURL
	}
	return strings.TrimRight(o.Issuer, "/") + "/protocol/openid-connect/certs"
}

// Identity is the verified partner user; Subject is their id at the partner.
// Email, EmailVerified and Name are used only to create a missing account.
type Identity struct {
	Issuer        string
	Subject       string
	TokenID       string
	Email         string
	EmailVerified bool
	Name          string
}

// RejectedClaims reports the claims of a correctly signed token that failed a
// claim or lifetime check, so the partner's client id and token lifespan can
// be read from the log.
type RejectedClaims struct {
	Reason   error
	ClientID string
	Audience []string
	Lifetime time.Duration
}

func (r *RejectedClaims) Error() string { return r.Reason.Error() }
func (r *RejectedClaims) Unwrap() error { return r.Reason }

// Account is the local user linked to a partner Identity.
type Account struct {
	ID          string
	Email       string
	Name        string
	AccessLevel string
}

type Verifier struct {
	opts     Options
	verifier *oidc.IDTokenVerifier
	keys     *expiringKeySet
}

// Create token verifier.
func New(opts Options) (*Verifier, error) {
	if err := opts.Validate(); err != nil {
		return nil, err
	}
	if opts.Issuer == "" {
		return nil, nil
	}
	if opts.MaxTokenLifetime == 0 {
		opts.MaxTokenLifetime = DefaultMaxTokenLifetime
	}
	client := &http.Client{
		Timeout: 10 * time.Second,
		// Reject JWKS redirects.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	keys := &expiringKeySet{client: client, url: opts.keysURL(), ttl: opts.CacheTTL}
	return &Verifier{opts: opts, keys: keys, verifier: oidc.NewVerifier(opts.Issuer, keys, &oidc.Config{
		ClientID: opts.Audience, SkipClientIDCheck: opts.Audience == "", SupportedSigningAlgs: []string{oidc.RS256},
	})}, nil
}

func (v *Verifier) Verify(ctx context.Context, raw string) (*Identity, error) {
	if v == nil {
		return nil, ErrUnavailable
	}
	if len(raw) == 0 || len(raw) > 32*1024 {
		return nil, ErrInvalidToken
	}
	token, err := v.verifier.Verify(ctx, raw)
	if err != nil {
		var expired *oidc.TokenExpiredError
		if errors.As(err, &expired) {
			return nil, ErrExpired
		}
		return nil, ErrInvalidToken
	}
	var claims struct {
		Type          string `json:"typ"`
		ClientID      string `json:"azp"`
		TokenID       string `json:"jti"`
		NotBefore     int64  `json:"nbf"`
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		Name          string `json:"name"`
	}
	if err := token.Claims(&claims); err != nil {
		return nil, ErrClaims
	}
	rejected := func(reason error) error {
		return &RejectedClaims{Reason: reason, ClientID: claims.ClientID, Audience: token.Audience,
			Lifetime: token.Expiry.Sub(token.IssuedAt)}
	}
	now := time.Now()
	if token.Issuer != v.opts.Issuer || strings.TrimSpace(token.Subject) == "" ||
		claims.Type != "Bearer" || claims.ClientID != v.opts.ClientID ||
		!now.Before(token.Expiry) || token.IssuedAt.After(now.Add(30*time.Second)) ||
		time.Unix(claims.NotBefore, 0).After(now.Add(30*time.Second)) {
		return nil, rejected(ErrClaims)
	}
	// Bound token lifetime.
	if token.IssuedAt.IsZero() || token.Expiry.Sub(token.IssuedAt) > v.opts.MaxTokenLifetime {
		return nil, rejected(ErrLifetime)
	}
	return &Identity{Issuer: token.Issuer, Subject: token.Subject, TokenID: claims.TokenID,
		Email: strings.TrimSpace(claims.Email), EmailVerified: claims.EmailVerified, Name: strings.TrimSpace(claims.Name)}, nil
}

// Minimum gap between downloads.
var jwksRefreshCooldown = 30 * time.Second

// Expiring JWKS cache.
type expiringKeySet struct {
	client  *http.Client
	url     string
	ttl     time.Duration
	fetchMu sync.Mutex
	mu      sync.Mutex
	keys    *oidc.StaticKeySet
	expires time.Time
	fetched time.Time
}

func (k *expiringKeySet) VerifySignature(ctx context.Context, raw string) ([]byte, error) {
	if keys := k.cached(); keys != nil {
		if payload, err := keys.VerifySignature(ctx, raw); err == nil {
			return payload, nil
		}
	}
	keys, err := k.refresh(ctx)
	if err != nil {
		return nil, err
	}
	return keys.VerifySignature(ctx, raw)
}

// Unexpired keys only.
func (k *expiringKeySet) cached() *oidc.StaticKeySet {
	k.mu.Lock()
	defer k.mu.Unlock()
	if k.keys == nil || !time.Now().Before(k.expires) {
		return nil
	}
	return k.keys
}

// Throttled download.
func (k *expiringKeySet) refresh(ctx context.Context) (*oidc.StaticKeySet, error) {
	k.fetchMu.Lock()
	defer k.fetchMu.Unlock()
	cooldown := min(jwksRefreshCooldown, k.ttl)
	k.mu.Lock()
	if time.Since(k.fetched) < cooldown {
		k.mu.Unlock()
		// Another request may have just fetched.
		if keys := k.cached(); keys != nil {
			return keys, nil
		}
		return nil, errors.New("signing key refresh throttled")
	}
	k.fetched = time.Now()
	k.mu.Unlock()
	keys, err := k.fetch(ctx)
	if err != nil {
		return nil, err
	}
	k.mu.Lock()
	k.keys, k.expires = keys, time.Now().Add(k.ttl)
	k.mu.Unlock()
	return keys, nil
}

func (k *expiringKeySet) fetch(ctx context.Context) (*oidc.StaticKeySet, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, k.url, nil)
	if err != nil {
		return nil, err
	}
	client := k.client
	if client == nil {
		client = http.DefaultClient
	}
	resp, err := client.Do(req)
	if err != nil {
		return nil, fmt.Errorf("fetch signing keys: %w", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("fetch signing keys: status %d", resp.StatusCode)
	}
	var set jose.JSONWebKeySet
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&set); err != nil {
		return nil, fmt.Errorf("decode signing keys: %w", err)
	}
	var public []crypto.PublicKey
	for _, key := range set.Keys {
		if (key.Use == "" || key.Use == "sig") && key.IsPublic() {
			public = append(public, key.Key)
		}
	}
	if len(public) == 0 {
		return nil, errors.New("no signing keys published")
	}
	return &oidc.StaticKeySet{PublicKeys: public}, nil
}
