package pylovo

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"

	"github.com/gin-gonic/gin"

	"platform.local/common/pkg/httputil"
	"platform.local/platform/logger"

	"spatialhub_backend/internal/city2tabula"
	"spatialhub_backend/internal/geo"
	"spatialhub_backend/internal/ignis"
)

// siteBuildingLimit caps the 3D-linked buildings of one site, below pylovo's
// own MAX_SITE_BUILDINGS.
const siteBuildingLimit = 150

// countryResolver names the country a geometry sits in.
// Satisfied by *geo.NominatimResolver; faked in tests.
type countryResolver interface {
	Resolve(ctx context.Context, coords json.RawMessage) (string, error)
}

// linkLookup returns the City2TABULA buildings linked to the given OSM ids.
// Satisfied by *city2tabula.Client; faked in tests.
type linkLookup interface {
	GetBuildingsByOSMIDs(ctx context.Context, country string, osmIDs []string) (city2tabula.BuildingsResult, error)
}

// SiteHandler serves the site-mode routes. pylovo stores a site's owner but
// does not authenticate, so every route here checks the owner itself.
type SiteHandler struct {
	pylovo  *PylovoHandler
	country countryResolver
	links   linkLookup
}

// NewSiteHandler returns a SiteHandler that reaches pylovo through h.
func NewSiteHandler(h *PylovoHandler, country countryResolver, links linkLookup) *SiteHandler {
	return &SiteHandler{pylovo: h, country: country, links: links}
}

type createSiteRequest struct {
	Name string          `json:"name" binding:"required"`
	Geom json.RawMessage `json:"geom" binding:"required"`
}

type siteBuildings struct {
	Features []struct {
		Properties struct {
			BuildingID int    `json:"building_id"`
			OSMID      string `json:"osm_id"`
		} `json:"properties"`
	} `json:"features"`
}

// CreateSite creates a site for the caller from a polygon. Only buildings with
// a City2TABULA link are modelled; the others are excluded in pylovo.
func (s *SiteHandler) CreateSite(c *gin.Context) {
	userID, ok := httputil.MustGetUserID(c)
	if !ok {
		return
	}
	var req createSiteRequest
	if !bindAreaRequest(c, &req) {
		return
	}
	geom, err := geo.ValidateArea(req.Geom)
	if err != nil {
		httputil.BadRequest(c, err.Error())
		return
	}
	ctx := c.Request.Context()
	countryName, iso, err := s.resolveCountry(ctx, geom)
	if err != nil {
		httputil.BadRequest(c, err.Error())
		return
	}

	payload, err := json.Marshal(map[string]any{
		"user_id": userID, "name": req.Name, "country_code": iso, "geom": geom,
	})
	if err != nil {
		httputil.BadRequest(c, fmt.Sprintf("invalid geometry: %v", err))
		return
	}
	body, status, ok := s.call(c, http.MethodPost, "/sites", payload)
	if !ok {
		return
	}
	var site map[string]any
	var created struct {
		SiteID int `json:"site_id"`
	}
	if json.Unmarshal(body, &site) != nil || json.Unmarshal(body, &created) != nil || created.SiteID == 0 {
		httputil.BadGateway(c, fmt.Sprintf("Unreadable site response from Pylovo: %s", body))
		return
	}
	siteID := created.SiteID

	linked, revision, err := s.excludeUnlinked(ctx, siteID, countryName)
	if err == nil && (linked == 0 || linked > siteBuildingLimit) {
		err = fmt.Errorf("the area holds %d buildings with 3D data; a site needs between 1 and %d", linked, siteBuildingLimit)
	}
	if err != nil {
		s.discard(ctx, siteID)
		httputil.ErrorResponse(c, http.StatusUnprocessableEntity, err.Error())
		return
	}
	site["building_count"] = linked
	site["revision"] = revision
	site["country"] = countryName
	c.JSON(status, gin.H{"success": true, "data": site})
}

// resolveCountry returns the geometry's country name and its ISO2 code.
func (s *SiteHandler) resolveCountry(ctx context.Context, geom json.RawMessage) (string, string, error) {
	name, err := s.country.Resolve(ctx, geom)
	if err != nil {
		return "", "", fmt.Errorf("could not resolve the country for this area: %w", err)
	}
	iso, ok := ignis.ISO2ForCountry(name)
	if !ok {
		return "", "", fmt.Errorf("site mode does not support country %q", name)
	}
	return name, iso, nil
}

// excludeUnlinked excludes the site's buildings that have no City2TABULA link
// and returns the number left and the site's revision afterwards.
func (s *SiteHandler) excludeUnlinked(ctx context.Context, siteID int, country string) (int, int, error) {
	body, status, err := forwardPylovoRequest(ctx, s.pylovo.resolveBaseURL(), http.MethodGet, fmt.Sprintf("/sites/%d/buildings", siteID), nil)
	if err != nil || status != http.StatusOK {
		return 0, 0, fmt.Errorf("listing buildings of site %d failed (status %d): %v", siteID, status, err)
	}
	var buildings siteBuildings
	if err := json.Unmarshal(body, &buildings); err != nil {
		return 0, 0, fmt.Errorf("unreadable buildings of site %d: %w", siteID, err)
	}
	osmIDs := make([]string, 0, len(buildings.Features))
	for _, f := range buildings.Features {
		if f.Properties.OSMID != "" {
			osmIDs = append(osmIDs, f.Properties.OSMID)
		}
	}
	result, err := s.links.GetBuildingsByOSMIDs(ctx, country, osmIDs)
	if err != nil {
		return 0, 0, fmt.Errorf("City2TABULA lookup for site %d failed: %w", siteID, err)
	}
	// A further way of a 3D building stays in the site as a grid node; its
	// demand is modelled under the way standing for the building.
	byWay, further := result.ByRequestedWay(osmIDs)
	linked := make(map[string]bool, len(byWay)+len(further))
	for way := range byWay {
		linked[way] = true
	}
	for way := range further {
		linked[way] = true
	}

	var patches []map[string]any
	for _, f := range buildings.Features {
		if !linked[f.Properties.OSMID] {
			patches = append(patches, map[string]any{
				"building_id": f.Properties.BuildingID, "overrides": map[string]any{"excluded": true},
			})
		}
	}
	count := len(buildings.Features) - len(patches)
	if len(patches) == 0 {
		return count, 1, nil
	}
	payload, err := json.Marshal(patches)
	if err != nil {
		return 0, 0, fmt.Errorf("encoding exclusions of site %d: %w", siteID, err)
	}
	body, status, err = forwardPylovoRequest(ctx, s.pylovo.resolveBaseURL(), http.MethodPatch, fmt.Sprintf("/sites/%d/buildings", siteID), payload)
	if err != nil || status != http.StatusOK {
		return 0, 0, fmt.Errorf("excluding unlinked buildings of site %d failed (status %d): %v %s", siteID, status, err, body)
	}
	var patched struct {
		Revision int `json:"revision"`
	}
	if err := json.Unmarshal(body, &patched); err != nil {
		return 0, 0, fmt.Errorf("unreadable revision of site %d: %w", siteID, err)
	}
	return count, patched.Revision, nil
}

// discard deletes a site whose creation could not complete.
func (s *SiteHandler) discard(ctx context.Context, siteID int) {
	if _, status, err := forwardPylovoRequest(ctx, s.pylovo.resolveBaseURL(), http.MethodDelete, fmt.Sprintf("/sites/%d", siteID), nil); err != nil || status != http.StatusNoContent {
		logger.Logger.Errorf("Failed to delete incomplete site %d (status %d): %v", siteID, status, err)
	}
}

// ListSites returns the caller's sites.
func (s *SiteHandler) ListSites(c *gin.Context) {
	userID, ok := httputil.MustGetUserID(c)
	if !ok {
		return
	}
	s.relay(c, http.MethodGet, "/sites?user_id="+url.QueryEscape(userID), nil)
}

// GetSite returns one of the caller's sites.
func (s *SiteHandler) GetSite(c *gin.Context) {
	if _, site, ok := s.ownedSite(c); ok {
		httputil.SuccessResponse(c, site)
	}
}

// DeleteSite deletes one of the caller's sites with its grid results.
func (s *SiteHandler) DeleteSite(c *gin.Context) {
	if id, _, ok := s.ownedSite(c); ok {
		if _, _, ok := s.call(c, http.MethodDelete, fmt.Sprintf("/sites/%d", id), nil); ok {
			httputil.NoContent(c)
		}
	}
}

// GenerateSite queues grid generation for the site's current revision.
func (s *SiteHandler) GenerateSite(c *gin.Context) {
	if id, _, ok := s.ownedSite(c); ok {
		s.relay(c, http.MethodPost, fmt.Sprintf("/sites/%d/generate", id), nil)
	}
}

// GetSiteJob returns the status of one of the site's generation jobs.
func (s *SiteHandler) GetSiteJob(c *gin.Context) {
	jobID, err := strconv.Atoi(c.Param("job_id"))
	if err != nil {
		httputil.BadRequest(c, fmt.Sprintf("invalid job id %q", c.Param("job_id")))
		return
	}
	if id, _, ok := s.ownedSite(c); ok {
		s.relay(c, http.MethodGet, fmt.Sprintf("/sites/%d/jobs/%d", id, jobID), nil)
	}
}

// GetSiteGrid returns the site's generated grid in the /generate-grid shape.
func (s *SiteHandler) GetSiteGrid(c *gin.Context) {
	if id, _, ok := s.ownedSite(c); ok {
		s.relay(c, http.MethodGet, fmt.Sprintf("/sites/%d/grid", id), nil)
	}
}

// GetSiteTransformers returns the site's stored stations with their fixed
// building assignments.
func (s *SiteHandler) GetSiteTransformers(c *gin.Context) {
	if id, _, ok := s.ownedSite(c); ok {
		s.relay(c, http.MethodGet, fmt.Sprintf("/sites/%d/transformers", id), nil)
	}
}

// PutSiteTransformers replaces the site's stations and fixed building
// assignments; pylovo validates each station and answers 422 on a bad one.
func (s *SiteHandler) PutSiteTransformers(c *gin.Context) {
	var stations []json.RawMessage
	if err := c.ShouldBindJSON(&stations); err != nil {
		httputil.BadRequest(c, fmt.Sprintf("expected a JSON array of stations: %v", err))
		return
	}
	id, _, ok := s.ownedSite(c)
	if !ok {
		return
	}
	payload, err := json.Marshal(stations)
	if err != nil {
		httputil.InternalError(c, errFailedMarshalPayload)
		return
	}
	s.relay(c, http.MethodPut, fmt.Sprintf("/sites/%d/transformers", id), payload)
}

// ownedSite fetches the site named by the :id parameter and answers 404 unless
// the caller owns it, so other users' site ids are not revealed.
func (s *SiteHandler) ownedSite(c *gin.Context) (int, map[string]any, bool) {
	siteID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		httputil.BadRequest(c, fmt.Sprintf("invalid site id %q", c.Param("id")))
		return 0, nil, false
	}
	site, ok := s.pylovo.requireSiteOwner(c, siteID)
	return siteID, site, ok
}

// requireSiteOwner answers 404 unless the caller owns siteID, so other users'
// site ids are not revealed; it returns false whenever it has answered.
func (h *PylovoHandler) requireSiteOwner(c *gin.Context, siteID int) (map[string]any, bool) {
	userID, ok := httputil.MustGetUserID(c)
	if !ok {
		return nil, false
	}
	site, err := h.siteOwnedBy(c.Request.Context(), siteID, userID)
	if err != nil {
		logger.Logger.Errorf("Site %d lookup failed: %v", siteID, err)
		httputil.BadGateway(c, "Pylovo unavailable")
		return nil, false
	}
	if site == nil {
		httputil.NotFound(c, fmt.Sprintf("Site %d not found", siteID))
		return nil, false
	}
	return site, true
}

// siteOwnedBy returns the site if userID owns it, or nil if it does not exist
// or belongs to someone else.
func (h *PylovoHandler) siteOwnedBy(ctx context.Context, siteID int, userID string) (map[string]any, error) {
	body, status, err := forwardPylovoRequest(ctx, h.resolveBaseURL(), http.MethodGet, fmt.Sprintf("/sites/%d", siteID), nil)
	if err != nil {
		return nil, err
	}
	if status == http.StatusNotFound {
		return nil, nil
	}
	if status != http.StatusOK {
		return nil, fmt.Errorf("pylovo answered %d for site %d", status, siteID)
	}
	var site map[string]any
	if err := json.Unmarshal(body, &site); err != nil {
		return nil, fmt.Errorf("unreadable site %d: %w", siteID, err)
	}
	if site["user_id"] != userID {
		return nil, nil
	}
	return site, nil
}

// relay forwards a call and answers with pylovo's body in the success envelope.
func (s *SiteHandler) relay(c *gin.Context, method, path string, payload []byte) {
	body, status, ok := s.call(c, method, path, payload)
	if ok {
		c.JSON(status, gin.H{"success": true, "data": json.RawMessage(body)})
	}
}

// call forwards a request to pylovo. On a pylovo 4xx it answers with the same
// status and pylovo's detail, so a 409 (job active) or 404 (no grid yet)
// reaches the client as such; it returns false whenever it has answered.
func (s *SiteHandler) call(c *gin.Context, method, path string, payload []byte) ([]byte, int, bool) {
	body, status, err := forwardPylovoRequest(c.Request.Context(), s.pylovo.resolveBaseURL(), method, path, payload)
	if err != nil {
		if clientGone(c) {
			abortClientGone(c, method, path)
			return nil, 0, false
		}
		logger.Logger.Errorf("Error contacting Pylovo (%s %s): %v", method, path, err)
		httputil.BadGateway(c, "Pylovo unavailable")
		return nil, 0, false
	}
	if status >= http.StatusInternalServerError {
		logger.Logger.Errorf("Pylovo answered %d for %s %s: %s", status, method, path, body)
		httputil.BadGateway(c, fmt.Sprintf("Pylovo service responded with %d", status))
		return nil, 0, false
	}
	if status >= http.StatusBadRequest {
		httputil.ErrorResponse(c, status, pylovoDetail(body))
		return nil, 0, false
	}
	return body, status, true
}

// pylovoDetail returns the message of a FastAPI error body: its detail string,
// or the raw body when detail is a validation list or missing.
func pylovoDetail(body []byte) string {
	var e struct {
		Detail any `json:"detail"`
	}
	if json.Unmarshal(body, &e) == nil {
		if msg, ok := e.Detail.(string); ok {
			return msg
		}
	}
	return string(body)
}
