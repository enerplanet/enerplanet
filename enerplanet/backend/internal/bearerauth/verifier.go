// SpatialHub token verification.
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
	"platform.local/common/pkg/constants"
)

const ReadScope = "enerplanet:read"

// Default lifetime ceiling.
const DefaultMaxTokenLifetime = 15 * time.Minute

// Loggable rejection reasons.
var (
	ErrUnavailable  = errors.New("unavailable")
	ErrExpired      = errors.New("expired")
	ErrInvalidToken = errors.New("invalid_token")
	ErrClaims       = errors.New("invalid_claims")
	ErrLifetime     = errors.New("lifetime_exceeded")
	ErrEmail        = errors.New("unverified_email")
	ErrAccessLevel  = errors.New("invalid_access_level")
)

type Options struct {
	Issuer    string
	Audience  string
	ClientID  string
	JWKSURL   string
	CacheTTL  time.Duration
	// Lifetime ceiling.
	MaxTokenLifetime time.Duration
	AllowHTTP        bool // Development only.
}

// Validate configuration.
func (o Options) Validate() error {
	if o.Issuer == "" && o.Audience == "" && o.ClientID == "" && o.JWKSURL == "" {
		return nil
	}
	if o.Issuer == "" || o.Audience == "" || o.ClientID == "" {
		return errors.New("bearer authentication requires issuer, API audience and toolbox client ID")
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

type Identity struct {
	Issuer      string `json:"issuer"`
	Subject     string `json:"subject"`
	Email       string `json:"email"`
	Name        string `json:"name"`
	AccessLevel string `json:"access_level"`
	Scope       string `json:"scope"`
	TokenID     string `json:"-"`
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
	if opts.Audience == "" {
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
		ClientID: opts.Audience, SupportedSigningAlgs: []string{oidc.RS256},
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
	// Lenient claim decoding.
	var claims struct {
		Type          string          `json:"typ"`
		ClientID      string          `json:"azp"`
		Email         string          `json:"email"`
		EmailVerified json.RawMessage `json:"email_verified"`
		Name          string          `json:"name"`
		AccessLevel   json.RawMessage `json:"access_level"`
		Scope         string          `json:"scope"`
		TokenID       string          `json:"jti"`
		NotBefore     int64           `json:"nbf"`
	}
	if err := token.Claims(&claims); err != nil {
		return nil, ErrClaims
	}
	now := time.Now()
	if token.Issuer != v.opts.Issuer || strings.TrimSpace(token.Subject) == "" ||
		claims.Type != "Bearer" || claims.ClientID != v.opts.ClientID ||
		!now.Before(token.Expiry) || token.IssuedAt.After(now.Add(30*time.Second)) ||
		time.Unix(claims.NotBefore, 0).After(now.Add(30*time.Second)) {
		return nil, ErrClaims
	}
	// Bound token lifetime.
	if token.IssuedAt.IsZero() || token.Expiry.Sub(token.IssuedAt) > v.opts.MaxTokenLifetime {
		return nil, ErrLifetime
	}
	verified, ok := boolClaim(claims.EmailVerified)
	if strings.TrimSpace(claims.Email) == "" || !ok || !verified {
		return nil, ErrEmail
	}
	level, ok := stringClaim(claims.AccessLevel)
	if !ok {
		return nil, ErrAccessLevel
	}
	switch level {
	case "":
		level = constants.AccessLevelVeryLow
	case constants.AccessLevelVeryLow, constants.AccessLevelIntermediate:
	case constants.AccessLevelManager, constants.AccessLevelExpert:
		// Limit delegated privileges.
		level = constants.AccessLevelIntermediate
	default:
		return nil, ErrAccessLevel
	}
	return &Identity{Issuer: token.Issuer, Subject: token.Subject, Email: claims.Email,
		Name: claims.Name, AccessLevel: level, Scope: claims.Scope, TokenID: claims.TokenID}, nil
}

// String or singleton.
func stringClaim(raw json.RawMessage) (string, bool) {
	if len(raw) == 0 || string(raw) == "null" {
		return "", true
	}
	var value string
	if json.Unmarshal(raw, &value) == nil {
		return value, true
	}
	var values []string
	if json.Unmarshal(raw, &values) == nil && len(values) <= 1 {
		if len(values) == 0 {
			return "", true
		}
		return values[0], true
	}
	return "", false
}

// Boolean or text.
func boolClaim(raw json.RawMessage) (bool, bool) {
	var value bool
	if json.Unmarshal(raw, &value) == nil {
		return value, true
	}
	text, ok := stringClaim(raw)
	if !ok {
		return false, false
	}
	switch text {
	case "true":
		return true, true
	case "false":
		return false, true
	}
	return false, false
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
