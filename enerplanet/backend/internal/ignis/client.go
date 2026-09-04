// Package ignis is a server-side client for the ignis heat-demand
// microservice (THD-Spatial-AI/ignis), used directly by backend jobs (run_buem,
// the heat-demand resolve endpoint) that need a TABULA variant resolved or
// calculated. This is separate from internal/handler/ignis, which is the
// public HTTP proxy the frontend calls; that proxy forwards requests verbatim
// and has no server-side caller of its own.
package ignis

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	httpclient "platform.local/common/pkg/httpclient"
)

// Client talks to ignis directly.
type Client struct {
	http *httpclient.Client
}

// NewClient creates a Client bound to ignis at baseURL.
func NewClient(baseURL string) *Client {
	return &Client{http: httpclient.New(baseURL, httpclient.WithTimeout(30*time.Second))}
}

// ErrNoVariant is returned by MatchVariants when the building type has no
// TABULA archetype for the resolved construction period — a real outcome
// (residential coverage varies by country and period), not a request error.
var ErrNoVariant = errors.New("ignis: no TABULA variant for this type and year")

// BadRequestError is a 400 from ignis (unsupported country, bad query param)
// carried through with its message.
type BadRequestError struct {
	Message string
}

func (e *BadRequestError) Error() string {
	return "ignis rejected the request: " + e.Message
}

func badRequestFromBody(body io.Reader) *BadRequestError {
	var parsed struct {
		Error string `json:"error"`
	}
	if err := json.NewDecoder(body).Decode(&parsed); err != nil || parsed.Error == "" {
		return &BadRequestError{Message: "bad request"}
	}
	return &BadRequestError{Message: parsed.Error}
}

func checkStatus(resp *http.Response, want int, op string) error {
	switch resp.StatusCode {
	case want:
		return nil
	case http.StatusBadRequest:
		return badRequestFromBody(resp.Body)
	default:
		return fmt.Errorf("ignis %s: unexpected status %d", op, resp.StatusCode)
	}
}

// isoByCountry maps geo.NormalizeCountry's canonical country names to the
// ISO 3166-1 alpha-2 codes ignis's TABULA tables key on. Limited to the
// countries geo.NormalizeCountry itself recognises, not ignis's full range.
var isoByCountry = map[string]string{
	"germany": "DE", "france": "FR", "austria": "AT", "switzerland": "CH",
	"netherlands": "NL", "belgium": "BE", "poland": "PL", "sweden": "SE",
	"norway": "NO", "finland": "FI", "denmark": "DK", "ireland": "IE",
	"czechia": "CZ", "romania": "RO", "hungary": "HU", "greece": "GR",
	"croatia": "HR", "bulgaria": "BG", "slovakia": "SK", "slovenia": "SI",
	"luxembourg": "LU", "estonia": "EE", "latvia": "LV", "lithuania": "LT",
	"spain": "ES", "italy": "IT", "portugal": "PT", "uk": "GB",
}

// ISO2ForCountry returns the ISO 3166-1 alpha-2 code for a canonical country
// name (as geo.NormalizeCountry produces it), or false if unknown to ignis.
func ISO2ForCountry(country string) (string, bool) {
	code, ok := isoByCountry[strings.ToLower(strings.TrimSpace(country))]
	return code, ok
}

// VariantMatch is one refurbishment-level variant for a building type and
// construction period.
type VariantMatch struct {
	Code  string `json:"code"`
	Label string `json:"label"`
}

// MatchVariants resolves the construction year to a TABULA period and returns
// its refurbishment variants (existing state first), via
// GET /api/v1/variants/{iso2}/match?type=&year=.
func (c *Client) MatchVariants(ctx context.Context, iso2, buildingType string, year int) ([]VariantMatch, error) {
	path := fmt.Sprintf("/api/v1/variants/%s/match?type=%s&year=%s",
		url.PathEscape(iso2), url.QueryEscape(buildingType), strconv.Itoa(year))

	resp, err := c.http.Do(ctx, http.MethodGet, path, nil, nil)
	if err != nil {
		return nil, fmt.Errorf("ignis match request failed: %w", err)
	}
	defer resp.Body.Close()
	if err := checkStatus(resp, http.StatusOK, "match"); err != nil {
		return nil, err
	}

	var body struct {
		Data []VariantMatch `json:"data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("failed to decode ignis match response: %w", err)
	}
	return body.Data, nil
}

// ExistingStateVariant returns the existing-state (first, unrefurbished)
// variant code for a building type and construction year, or ErrNoVariant if
// TABULA has no archetype covering it.
func (c *Client) ExistingStateVariant(ctx context.Context, iso2, buildingType string, year int) (string, error) {
	matches, err := c.MatchVariants(ctx, iso2, buildingType, year)
	if err != nil {
		return "", err
	}
	if len(matches) == 0 {
		return "", ErrNoVariant
	}
	return matches[0].Code, nil
}

// EnvelopeUValues is the subset of a TABULA variant's physical inputs run_buem
// needs to make BuEM accept a building: original U-values for the three
// envelope categories it sends (wall, roof, floor). Window/door U-values are
// not read — run_buem sends no explicit window or door elements; BuEM
// synthesizes them (see #61).
type EnvelopeUValues struct {
	Wall  float64 // W/(m2.K)
	Roof  float64
	Floor float64
}

// GetEnvelopeUValues fetches a TABULA variant's data and extracts its
// wall/roof/floor U-values, via GET /api/v1/data/{code}.
func (c *Client) GetEnvelopeUValues(ctx context.Context, variantCode string) (EnvelopeUValues, error) {
	path := "/api/v1/data/" + url.PathEscape(variantCode)

	resp, err := c.http.Do(ctx, http.MethodGet, path, nil, nil)
	if err != nil {
		return EnvelopeUValues{}, fmt.Errorf("ignis data request failed: %w", err)
	}
	defer resp.Body.Close()
	if err := checkStatus(resp, http.StatusOK, "data"); err != nil {
		return EnvelopeUValues{}, err
	}

	var body struct {
		TabulaData struct {
			AdvancedParameters struct {
				Uvalues struct {
					U_Wall_1  float64
					U_Roof_1  float64
					U_Floor_1 float64
				}
			}
		} `json:"tabula_data"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return EnvelopeUValues{}, fmt.Errorf("failed to decode ignis data response: %w", err)
	}
	u := body.TabulaData.AdvancedParameters.Uvalues
	return EnvelopeUValues{Wall: u.U_Wall_1, Roof: u.U_Roof_1, Floor: u.U_Floor_1}, nil
}

// CalculateResult is ignis's annual specific heating demand for a variant.
type CalculateResult struct {
	VariantCode string  `json:"variant_code"`
	QHNDKwhM2a  float64 `json:"q_h_nd"`
}

// Calculate runs the ISO 13790 pipeline for a variant with an empty override
// body: every archetype row already carries country climate, room height,
// envelope areas and U-values, so {} is the correct minimal call. Do not pass
// A_ref — sending it alone distorts q_h_nd/m2 against a fixed archetype
// envelope (verified: 13.22 -> 1.55 kWh/(m2.a) for A_ref 150 -> 300 with no
// matching surface change). Multiply the returned q_h_nd by the caller's
// actual floor area for the absolute annual figure.
func (c *Client) Calculate(ctx context.Context, variantCode string) (CalculateResult, error) {
	path := "/api/v1/calculate/" + url.PathEscape(variantCode)

	resp, err := c.http.DoJSON(ctx, http.MethodPost, path, map[string]any{}, nil)
	if err != nil {
		return CalculateResult{}, fmt.Errorf("ignis calculate request failed: %w", err)
	}
	defer resp.Body.Close()
	if err := checkStatus(resp, http.StatusOK, "calculate"); err != nil {
		return CalculateResult{}, err
	}

	var result CalculateResult
	if err := json.NewDecoder(resp.Body).Decode(&result); err != nil {
		return CalculateResult{}, fmt.Errorf("failed to decode ignis calculate response: %w", err)
	}
	return result, nil
}
