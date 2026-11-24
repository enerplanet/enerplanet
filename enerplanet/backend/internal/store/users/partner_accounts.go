package users

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	urlpkg "net/url"
	"sync"
	"time"

	"spatialhub_backend/internal/bearerauth"
	"spatialhub_backend/internal/config"

	"platform.local/common/pkg/constants"
)

// AdminTokenSource issues Keycloak admin API tokens.
type AdminTokenSource interface {
	GetToken() (string, error)
}

// PartnerAccounts resolves a partner identity provider user to the linked
// local account, creating it on first use as a first EnerPlanET sign-in would.
type PartnerAccounts struct {
	store  *Store
	tokens AdminTokenSource
	alias  string
	ttl    time.Duration

	mu    sync.Mutex
	cache map[string]cachedAccount
}

type cachedAccount struct {
	account *bearerauth.Account
	expires time.Time
}

const partnerAccountTTL = 2 * time.Minute

const maxPartnerAccounts = 10000

// NewPartnerAccounts resolves users of the identity provider named by
// cfg.BearerAuth.IdentityProvider.
func NewPartnerAccounts(cfg *config.Config, tokens AdminTokenSource) *PartnerAccounts {
	return &PartnerAccounts{store: New(cfg), tokens: tokens, alias: cfg.BearerAuth.IdentityProvider,
		ttl: partnerAccountTTL, cache: map[string]cachedAccount{}}
}

// FindUsersByIdentityProvider returns the users linked to idpUserID at the
// identity provider alias.
func (s *Store) FindUsersByIdentityProvider(authToken, alias, idpUserID string) ([]User, error) {
	url := fmt.Sprintf("%s/admin/realms/%s/users?briefRepresentation=false&idpAlias=%s&idpUserId=%s",
		s.cfg.Auth.BaseURL, s.cfg.Auth.Realm, urlpkg.QueryEscape(alias), urlpkg.QueryEscape(idpUserID))
	return s.getKeycloakUsers(authToken, url)
}

// CreateLinkedUser creates an enabled account for the partner user, linked to
// them at the identity provider alias. It reports false when Keycloak refuses
// because the username or email is already taken.
func (s *Store) CreateLinkedUser(authToken, alias string, id *bearerauth.Identity) (bool, error) {
	name := id.Name
	if name == "" {
		name = id.Email
	}
	body, err := json.Marshal(map[string]any{
		"username":      id.Email,
		"email":         id.Email,
		"enabled":       true,
		"emailVerified": true,
		"attributes": map[string][]string{
			"access_level": {constants.AccessLevelVeryLow},
			"fullName":     {name},
			"model_limit":  {fmt.Sprintf("%d", getDefaultModelLimit(constants.AccessLevelVeryLow))},
		},
		"federatedIdentities": []map[string]string{
			{"identityProvider": alias, "userId": id.Subject, "userName": id.Email},
		},
	})
	if err != nil {
		return false, fmt.Errorf(errMarshalPayload, err)
	}
	url := fmt.Sprintf("%s/admin/realms/%s/users", s.cfg.Auth.BaseURL, s.cfg.Auth.Realm)
	resp, err := s.keycloakRequest("POST", url, authToken, bytes.NewReader(body))
	if err != nil {
		return false, err
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode == http.StatusConflict {
		return false, nil
	}
	return true, checkKeycloakResponse(resp, http.StatusCreated)
}

// Resolve returns the enabled local account linked to the partner user. A user
// with a verified email and no account gets one; if the email already belongs
// to an unlinked account it returns ErrEmailInUse, since linking by email alone
// would hand that account to whoever controls the partner account.
func (p *PartnerAccounts) Resolve(id *bearerauth.Identity) (*bearerauth.Account, error) {
	now := time.Now()
	p.mu.Lock()
	if e, ok := p.cache[id.Subject]; ok && now.Before(e.expires) {
		p.mu.Unlock()
		return e.account, nil
	}
	p.mu.Unlock()
	account, err := p.resolve(id)
	if err != nil {
		return nil, err
	}
	p.mu.Lock()
	if len(p.cache) >= maxPartnerAccounts {
		p.cache = map[string]cachedAccount{}
	}
	p.cache[id.Subject] = cachedAccount{account: account, expires: now.Add(p.ttl)}
	p.mu.Unlock()
	return account, nil
}

// uncached lookup.
func (p *PartnerAccounts) resolve(id *bearerauth.Identity) (*bearerauth.Account, error) {
	token, err := p.tokens.GetToken()
	if err != nil {
		return nil, fmt.Errorf("admin token for partner user %s: %w", id.Subject, err)
	}
	account, err := p.linked(token, id.Subject)
	if !errors.Is(err, bearerauth.ErrNotLinked) || id.Email == "" || !id.EmailVerified {
		return account, err
	}
	created, err := p.store.CreateLinkedUser(token, p.alias, id)
	if err != nil {
		return nil, fmt.Errorf("create account for %s user %s: %w", p.alias, id.Subject, err)
	}
	account, err = p.linked(token, id.Subject)
	if errors.Is(err, bearerauth.ErrNotLinked) && !created {
		return nil, bearerauth.ErrEmailInUse
	}
	return account, err
}

// linked returns the enabled local account linked to partnerUserID.
func (p *PartnerAccounts) linked(token, partnerUserID string) (*bearerauth.Account, error) {
	users, err := p.store.FindUsersByIdentityProvider(token, p.alias, partnerUserID)
	if err != nil {
		return nil, fmt.Errorf("find user linked to %s user %s: %w", p.alias, partnerUserID, err)
	}
	switch {
	case len(users) == 0:
		return nil, bearerauth.ErrNotLinked
	case len(users) > 1:
		return nil, fmt.Errorf("%d users linked to %s user %s", len(users), p.alias, partnerUserID)
	case !users[0].Enabled:
		return nil, bearerauth.ErrDisabled
	}
	u := users[0]
	name := getAttribute(u.Attributes, "fullName")
	if name == "" {
		name = u.Email
	}
	level := getAttribute(u.Attributes, "access_level")
	if level == "" {
		level = constants.AccessLevelVeryLow
	}
	return &bearerauth.Account{ID: u.ID, Email: u.Email, Name: name, AccessLevel: level}, nil
}

func getAttribute(attributes map[string][]string, key string) string {
	if values := attributes[key]; len(values) > 0 {
		return values[0]
	}
	return ""
}
