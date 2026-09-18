// Package ignis serves the frontend heat-demand form's ignis lookups (the
// building-type list and the input-field catalogue) through the TentaCron
// orchestrator. The backend makes no direct ignis call.
package ignis

import (
	"errors"
	"net/http"
	"strconv"

	"platform.local/common/pkg/httputil"
	"platform.local/platform/logger"

	"github.com/gin-gonic/gin"

	_ "spatialhub_backend/internal/api/contracts" // swagger response types
	"spatialhub_backend/internal/tentacron"
)

// IgnisHandler serves the frontend's ignis proxy routes via TentaCron, keeping
// the {success, data} envelope the form expects (it reads response.data.data).
type IgnisHandler struct {
	tc *tentacron.Client
}

// NewIgnisHandler creates a handler that reaches ignis through the given
// TentaCron client.
func NewIgnisHandler(tc *tentacron.Client) *IgnisHandler {
	return &IgnisHandler{tc: tc}
}

// ignisRejectionCodes are the TentaCron job error codes that mean ignis itself
// declined the request (unsupported country, unknown code), not an
// infrastructure fault.
var ignisRejectionCodes = map[string]bool{
	"target_error":      true,
	"target_job_failed": true,
	"target_timeout":    true,
}

// ignisRejectedMessage stands in for ignis's own rejection text, which reaches
// a browser from here and can name internal storage; it goes to the log.
const ignisRejectedMessage = "ignis could not serve this request"

// forward runs a TentaCron target and writes its verbatim ignis response back
// wrapped in the success envelope. An ignis rejection becomes a 400; anything
// else is a 502. Either way the client gets a fixed message and the detail
// goes to the log.
func (h *IgnisHandler) forward(c *gin.Context, target string, payload any) {
	var result map[string]any
	if err := h.tc.Do(c.Request.Context(), target, payload, &result); err != nil {
		var te *tentacron.TargetError
		if errors.As(err, &te) && ignisRejectionCodes[te.Code] {
			logger.Logger.Warnf("ignis via tentacron (%s) rejected the request: %s", target, te.UpstreamMessage())
			httputil.ErrorResponse(c, http.StatusBadRequest, ignisRejectedMessage)
			return
		}
		logger.Logger.Errorf("ignis via tentacron (%s): %v", target, err)
		httputil.BadGateway(c, "ignis unavailable")
		return
	}
	httputil.SuccessResponse(c, result)
}

// GetVariants godoc
//
//	@Summary		List a country's TABULA variant codes
//	@Description	Lists every TABULA archetype variant code ignis has for a country, for the
//	@Description	heat-demand form's building-type dropdown.
//	@Tags			Ignis
//	@Produce		json
//	@Param			country_iso2	path		string	true	"ISO 3166-1 alpha-2 country code"	example(DE)
//	@Success		200				{object}	contracts.GetIgnisVariantsResponse
//	@Failure		400				{object}	contracts.ErrorResponse	"ignis declined the request"
//	@Failure		502				{object}	contracts.ErrorResponse	"ignis unavailable"
//	@Security		SessionAuth
//	@Router			/v2/ignis/variants/{country_iso2} [get]
func (h *IgnisHandler) GetVariants(c *gin.Context) {
	h.forward(c, "ignis-variants", map[string]any{"iso2": c.Param("country_iso2")})
}

// GetFieldMetadata godoc
//
//	@Summary		Get the TABULA input-field catalogue
//	@Description	Returns the country-independent TABULA input-field catalogue (label, unit) used
//	@Description	to label the heat-demand form's inputs.
//	@Tags			Ignis
//	@Produce		json
//	@Success		200	{object}	contracts.GetIgnisFieldMetadataResponse
//	@Failure		502	{object}	contracts.ErrorResponse	"ignis unavailable"
//	@Security		SessionAuth
//	@Router			/v2/ignis/fields [get]
func (h *IgnisHandler) GetFieldMetadata(c *gin.Context) {
	h.forward(c, "ignis-fields", map[string]any{})
}

// MatchVariants godoc
//
//	@Summary		List the TABULA refurbishment variants matching a building
//	@Description	Resolves a construction year to its TABULA period and returns that period's
//	@Description	refurbishment variants for the building type, existing state first. This is the
//	@Description	list behind the building configurator's refurbishment-level selector.
//	@Tags			Ignis
//	@Produce		json
//	@Param			country_iso2	path		string	true	"ISO 3166-1 alpha-2 country code"	example(NL)
//	@Param			type			query		string	true	"TABULA building type"				example(SFH)
//	@Param			year			query		int		true	"Construction year"					example(1975)
//	@Success		200				{object}	contracts.GetIgnisVariantsResponse
//	@Failure		400				{object}	contracts.ErrorResponse	"ignis declined the request"
//	@Failure		502				{object}	contracts.ErrorResponse	"ignis unavailable"
//	@Security		SessionAuth
//	@Router			/v2/ignis/variants/{country_iso2}/match [get]
func (h *IgnisHandler) MatchVariants(c *gin.Context) {
	year, err := strconv.Atoi(c.Query("year"))
	if err != nil {
		httputil.BadRequest(c, "year must be a whole number, got "+c.Query("year"))
		return
	}
	h.forward(c, "ignis-variants-match", map[string]any{
		"iso2": c.Param("country_iso2"),
		"type": c.Query("type"),
		"year": year,
	})
}

// GetVariantData godoc
//
//	@Summary		Get one TABULA variant's full record
//	@Description	Returns every TABULA input for a variant code: the U-values, areas and
//	@Description	appearance parameters the configurator shows and edits.
//	@Tags			Ignis
//	@Produce		json
//	@Param			code	path		string	true	"TABULA variant code"	example(NL.N.SFH.05.Gen.ReEx.001.001)
//	@Success		200		{object}	contracts.GetIgnisVariantsResponse
//	@Failure		400		{object}	contracts.ErrorResponse	"ignis declined the request"
//	@Failure		502		{object}	contracts.ErrorResponse	"ignis unavailable"
//	@Security		SessionAuth
//	@Router			/v2/ignis/data/{code} [get]
func (h *IgnisHandler) GetVariantData(c *gin.Context) {
	h.forward(c, "ignis-data", map[string]any{"code": c.Param("code")})
}

// Calculate godoc
//
//	@Summary		Run the TABULA annual heat-demand calculation for a variant
//	@Description	Runs ignis's EN ISO 13790 pipeline for a variant code, with any TABULA inputs the
//	@Description	caller overrides in the body. Returns the annual specific heat demand.
//	@Tags			Ignis
//	@Accept			json
//	@Produce		json
//	@Param			code	path		string			true	"TABULA variant code"	example(NL.N.SFH.05.Gen.ReEx.001.001)
//	@Param			request	body		object			false	"TABULA input overrides"
//	@Success		200		{object}	contracts.GetIgnisVariantsResponse
//	@Failure		400		{object}	contracts.ErrorResponse	"ignis declined the request"
//	@Failure		502		{object}	contracts.ErrorResponse	"ignis unavailable"
//	@Security		SessionAuth
//	@Router			/v2/ignis/calculate/{code} [post]
func (h *IgnisHandler) Calculate(c *gin.Context) {
	// An empty body is a valid call: it runs the archetype unmodified.
	payload := map[string]any{}
	if c.Request.ContentLength != 0 {
		if err := c.ShouldBindJSON(&payload); err != nil {
			httputil.BadRequest(c, "invalid request payload")
			return
		}
	}
	// The target templates {code} into the path and strips it from the body, so
	// a caller cannot smuggle a different variant through the overrides.
	payload["code"] = c.Param("code")
	h.forward(c, "ignis-calculate", payload)
}
