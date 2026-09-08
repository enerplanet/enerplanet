// Package ignis serves the frontend heat-demand form's ignis lookups (the
// building-type list and the input-field catalogue) through the TentaCron
// orchestrator. The backend makes no direct ignis call.
package ignis

import (
	"errors"
	"net/http"

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

// forward runs a TentaCron target and writes its verbatim ignis response back
// wrapped in the success envelope. An ignis rejection becomes a 400 carrying
// ignis's own message; anything else is a 502.
func (h *IgnisHandler) forward(c *gin.Context, target string, payload any) {
	var result map[string]any
	if err := h.tc.Do(c.Request.Context(), target, payload, &result); err != nil {
		var te *tentacron.TargetError
		if errors.As(err, &te) && ignisRejectionCodes[te.Code] {
			httputil.ErrorResponse(c, http.StatusBadRequest, te.UpstreamMessage())
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
//	@Failure		400				{object}	contracts.ErrorResponse	"unsupported country"
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
