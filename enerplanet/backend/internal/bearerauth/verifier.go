// SpatialHub token verification.
package bearerauth

import (
	"context"
	"errors"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"platform.local/common/pkg/constants"
)

const ReadScope = "enerplanet:read"

type Options struct {
	Issuer    string
	Audience  string
	ClientID  string
	JWKSURL   string
	CacheTTL  time.Duration
	AllowHTTP bool // Development only.
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
	for _, raw := range []string{o.Issuer, o.keysURL()} {
		u, err := url.Parse(raw)
		if err != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" ||
			(u.Scheme != "https" && !(o.AllowHTTP && u.Scheme == "http")) {
			return errors.New("bearer issuer and JWKS URL must be absolute HTTPS URLs (HTTP allowed in development)")
		}
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
}

type Verifier struct {
	opts     Options
	verifier *oidc.IDTokenVerifier
}

// Create token verifier.
func New(opts Options) (*Verifier, error) {
	if err := opts.Validate(); err != nil {
		return nil, err
	}
	if opts.Audience == "" {
		return nil, nil
	}
	client := &http.Client{
		Timeout: 10 * time.Second,
		// Reject JWKS redirects.
		CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
	}
	keys := &expiringKeySet{
		ctx: oidc.ClientContext(context.Background(), client),
		url: opts.keysURL(), ttl: opts.CacheTTL,
	}
	return &Verifier{opts: opts, verifier: oidc.NewVerifier(opts.Issuer, keys, &oidc.Config{
		ClientID: opts.Audience, SupportedSigningAlgs: []string{oidc.RS256},
	})}, nil
}

func (v *Verifier) Verify(ctx context.Context, raw string) (*Identity, error) {
	if v == nil || len(raw) == 0 || len(raw) > 32*1024 {
		return nil, errors.New("bearer authentication unavailable or invalid token size")
	}
	token, err := v.verifier.Verify(ctx, raw)
	if err != nil {
		return nil, err
	}
	var claims struct {
		Type          string `json:"typ"`
		ClientID      string `json:"azp"`
		Email         string `json:"email"`
		EmailVerified bool   `json:"email_verified"`
		Name          string `json:"name"`
		AccessLevel   string `json:"access_level"`
		Scope         string `json:"scope"`
		NotBefore     int64  `json:"nbf"`
	}
	if err := token.Claims(&claims); err != nil {
		return nil, err
	}
	now := time.Now()
	if token.Issuer != v.opts.Issuer || strings.TrimSpace(token.Subject) == "" ||
		claims.Type != "Bearer" || claims.ClientID != v.opts.ClientID ||
		!now.Before(token.Expiry) || token.IssuedAt.After(now.Add(30*time.Second)) ||
		time.Unix(claims.NotBefore, 0).After(now.Add(30*time.Second)) {
		return nil, errors.New("invalid access-token claims")
	}
	// Require verified email.
	if strings.TrimSpace(claims.Email) == "" || !claims.EmailVerified {
		return nil, errors.New("a verified SpatialHub email is required")
	}
	switch claims.AccessLevel {
	case "":
		claims.AccessLevel = constants.AccessLevelVeryLow
	case constants.AccessLevelVeryLow, constants.AccessLevelIntermediate:
	case constants.AccessLevelManager, constants.AccessLevelExpert:
		// Limit delegated privileges.
		claims.AccessLevel = constants.AccessLevelIntermediate
	default:
		return nil, errors.New("missing or unsupported access level")
	}
	return &Identity{Issuer: token.Issuer, Subject: token.Subject, Email: claims.Email,
		Name: claims.Name, AccessLevel: claims.AccessLevel, Scope: claims.Scope}, nil
}

// Expiring JWKS cache.
type expiringKeySet struct {
	ctx     context.Context
	url     string
	ttl     time.Duration
	mu      sync.Mutex
	keys    *oidc.RemoteKeySet
	expires time.Time
}

func (k *expiringKeySet) VerifySignature(ctx context.Context, raw string) ([]byte, error) {
	k.mu.Lock()
	if k.keys == nil || !time.Now().Before(k.expires) {
		k.keys = oidc.NewRemoteKeySet(k.ctx, k.url)
		k.expires = time.Now().Add(k.ttl)
	}
	keys := k.keys
	k.mu.Unlock()
	return keys.VerifySignature(ctx, raw)
}
