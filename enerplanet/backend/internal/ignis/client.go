// Package ignis resolves TABULA variants and heat demand from the ignis
// microservice (THD-Spatial-AI/ignis), reached through the TentaCron
// orchestrator - the backend makes no direct ignis call. Used by backend jobs
// (run_buem, the heat-demand resolve endpoint) that need a TABULA variant
// resolved or calculated.
//
// This is separate from internal/handler/ignis, the public HTTP proxy the
// frontend form calls for its dropdown data; that proxy also goes through
// TentaCron.
package ignis

import (
	"context"
	"errors"
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

// asIgnisError maps a TentaCron *TargetError from an ignis rejection to a
// *BadRequestError carrying ignis's own message. Anything that is not an ignis
// rejection is returned unchanged.
func asIgnisError(err error) error {
	te, ok := tentacron.AsTargetError(err)
	if !ok || !ignisRejectionCodes[te.Code] {
		return err
	}
	return &BadRequestError{Message: te.UpstreamMessage()}
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
// needs to make BuEM accept a building: per-type effective U-values and
// adjacency correction factors for the three envelope categories it sends
// (wall, roof, floor), plus the envelope-level thermal-bridging surcharge.
// Window/door values are not read - run_buem sends no explicit window or door
// elements; BuEM synthesizes them (see #61).
//
// U* come from ignis's U_Actual_*_1, the post-measure-blend transmittance ignis
// uses for opaque conduction - not the base U_*_1, which ignis uses only for
// openings and which for some NL periods carries the wall value on all three
// fields. BTrans* are ignis's b_Transmission_*_1 (1.0 for elements facing
// outside, lower for elements against unheated space - typically ~0.5 on the
// ground floor). Bridging is one envelope-wide scalar; BuEM has no bridging
// surcharge of its own, so the caller adds it to each element's U
// (delta x total_area == sum of delta x element_area).
type EnvelopeUValues struct {
	UWall  float64 // W/(m2.K), U_Actual before the bridging surcharge
	URoof  float64
	UFloor float64

	BTransWall  float64 // dimensionless, TABULA b_Transmission
	BTransRoof  float64
	BTransFloor float64

	Bridging float64 // W/(m2.K), envelope-level thermal-bridging delta to add per element
}

// GetEnvelopeUValues fetches a TABULA variant's data and extracts the effective
// per-type wall/roof/floor U-values (U_Actual_*_1), their b_Transmission
// factors, and the envelope thermal-bridging delta, via the ignis-data target
// (GET /api/v1/data/{code}).
func (c *Client) GetEnvelopeUValues(ctx context.Context, variantCode string) (EnvelopeUValues, error) {
	var body struct {
		TabulaData struct {
			AdvancedParameters struct {
				Uvalues struct {
					U_Actual_Wall_1  float64
					U_Actual_Roof_1  float64
					U_Actual_Floor_1 float64
				}
				HeatLosses struct {
					B_Transmission_Wall_1  float64
					B_Transmission_Roof_1  float64
					B_Transmission_Floor_1 float64
				}
				ThermalBridges struct {
					DeltaU float64 `json:"delta_U_ThermalBridging_Original"`
				}
			}
		} `json:"tabula_data"`
	}
	if err := c.tc.Do(ctx, targetData, map[string]any{"code": variantCode}, &body); err != nil {
		return EnvelopeUValues{}, asIgnisError(err)
	}
	ap := body.TabulaData.AdvancedParameters
	return EnvelopeUValues{
		UWall:       ap.Uvalues.U_Actual_Wall_1,
		URoof:       ap.Uvalues.U_Actual_Roof_1,
		UFloor:      ap.Uvalues.U_Actual_Floor_1,
		BTransWall:  ap.HeatLosses.B_Transmission_Wall_1,
		BTransRoof:  ap.HeatLosses.B_Transmission_Roof_1,
		BTransFloor: ap.HeatLosses.B_Transmission_Floor_1,
		Bridging:    ap.ThermalBridges.DeltaU,
	}, nil
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
