// Package ignis resolves TABULA variants and heat demand from the ignis
// microservice (THD-Spatial-AI/ignis), reached through the TentaCron
// orchestrator - the backend makes no direct ignis call. Used by backend jobs
// (run_buem, the heat-demand resolve endpoint) that need a TABULA variant
// resolved or calculated.
//
// This is separate from internal/handler/ignis, the public HTTP proxy the
// frontend form calls for its dropdown data; that proxy still forwards to
// ignis directly.
package ignis

import (
	"context"
	"encoding/json"
	"errors"
	"regexp"
	"strings"

	"spatialhub_backend/internal/tentacron"
)

// TentaCron target names for the three ignis calls. Each is a proxy target
// with response.mode direct (ignis answers synchronously); TentaCron maps the
// payload onto the ignis URL per its target config.
const (
	targetCalculate     = "ignis-calculate"
	targetVariantsMatch = "ignis-variants-match"
	targetData          = "ignis-data"
)

// Client resolves ignis data through TentaCron.
type Client struct {
	tc *tentacron.Client
}

// NewClient returns a Client that reaches ignis through the given TentaCron
// client.
func NewClient(tc *tentacron.Client) *Client {
	return &Client{tc: tc}
}

// ErrNoVariant is returned by ExistingStateVariant when the building type has
// no TABULA archetype for the resolved construction period - a real outcome
// (residential coverage varies by country and period), not a request error.
var ErrNoVariant = errors.New("ignis: no TABULA variant for this type and year")

// BadRequestError is an ignis-side rejection or failure carried through with
// its message: an unsupported country or query param (ignis 400), an unknown
// variant code (ignis 404), or an ignis timeout. The heat-demand resolver
// treats it the same as any ignis miss and falls back to the estimate.
type BadRequestError struct {
	Message string
}

func (e *BadRequestError) Error() string {
	return "ignis rejected the request: " + e.Message
}

// ignisRejectionCodes are the TentaCron job error codes that mean ignis
// itself declined or failed the call. Other codes (unknown_target,
// invalid_payload, max_attempts_exceeded, internal) are backend or
// infrastructure faults and are returned as the raw *tentacron.TargetError so
// a misconfiguration is not silently indistinguishable from an ignis "no".
var ignisRejectionCodes = map[string]bool{
	"target_error":      true,
	"target_job_failed": true,
	"target_timeout":    true,
}

// targetErrMsgPrefix is TentaCron's "target <name>: HTTP <status>: " stamp on
// an upstream HTTP failure message; stripped so BadRequestError.Message
// carries just the ignis text.
var targetErrMsgPrefix = regexp.MustCompile(`^target \S+: HTTP \d+: `)

// asIgnisError maps a TentaCron *TargetError from an ignis rejection to a
// *BadRequestError carrying ignis's own message. ignis 400 bodies are
// {"error":"<text>"}; the bare text is unwrapped when present. Anything that
// is not an ignis rejection is returned unchanged.
func asIgnisError(err error) error {
	te, ok := tentacron.AsTargetError(err)
	if !ok || !ignisRejectionCodes[te.Code] {
		return err
	}
	msg := strings.TrimSpace(targetErrMsgPrefix.ReplaceAllString(te.Message, ""))
	var body struct {
		Error string `json:"error"`
	}
	if json.Unmarshal([]byte(msg), &body) == nil && body.Error != "" {
		msg = body.Error
	}
	return &BadRequestError{Message: msg}
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
// its refurbishment variants (existing state first), via the
// ignis-variants-match target (GET /api/v1/variants/{iso2}/match?type=&year=).
func (c *Client) MatchVariants(ctx context.Context, iso2, buildingType string, year int) ([]VariantMatch, error) {
	payload := map[string]any{"iso2": iso2, "type": buildingType, "year": year}
	var body struct {
		Data []VariantMatch `json:"data"`
	}
	if err := c.tc.Do(ctx, targetVariantsMatch, payload, &body); err != nil {
		return nil, asIgnisError(err)
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
// not read - run_buem sends no explicit window or door elements; BuEM
// synthesizes them (see #61).
type EnvelopeUValues struct {
	Wall  float64 // W/(m2.K)
	Roof  float64
	Floor float64
}

// GetEnvelopeUValues fetches a TABULA variant's data and extracts its
// wall/roof/floor U-values, via the ignis-data target (GET /api/v1/data/{code}).
func (c *Client) GetEnvelopeUValues(ctx context.Context, variantCode string) (EnvelopeUValues, error) {
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
	if err := c.tc.Do(ctx, targetData, map[string]any{"code": variantCode}, &body); err != nil {
		return EnvelopeUValues{}, asIgnisError(err)
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
// A_ref - sending it alone distorts q_h_nd/m2 against a fixed archetype
// envelope (verified: 13.22 -> 1.55 kWh/(m2.a) for A_ref 150 -> 300 with no
// matching surface change). Multiply the returned q_h_nd by the caller's
// actual floor area for the absolute annual figure. Via the ignis-calculate
// target (POST /api/v1/calculate/{code}).
func (c *Client) Calculate(ctx context.Context, variantCode string) (CalculateResult, error) {
	payload := map[string]any{"code": variantCode}
	var result CalculateResult
	if err := c.tc.Do(ctx, targetCalculate, payload, &result); err != nil {
		return CalculateResult{}, asIgnisError(err)
	}
	return result, nil
}
