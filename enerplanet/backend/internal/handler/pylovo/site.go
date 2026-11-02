package pylovo

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"

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

// buildings3D finds a site's City2TABULA buildings and their WGS84 footprints.
// Satisfied by *city2tabula.Client; faked in tests.
type buildings3D interface {
	GetBuildingsByOSMIDs(ctx context.Context, country string, osmIDs []string) (city2tabula.BuildingsResult, error)
	GetBuildingsInBBox(ctx context.Context, country string, bbox city2tabula.Bbox) (city2tabula.BuildingsResult, error)
	GetFootprintsWGS84(ctx context.Context, country string, objectIDs []string) (city2tabula.GeometryResult, error)
}

// siteModels names the saved models whose grid is a site.
// Satisfied by *modelstore.Store; faked in tests.
type siteModels interface {
	ModelsUsingSite(siteID int) ([]string, error)
}

// SiteHandler serves the site-mode routes. pylovo stores a site's owner but
// does not authenticate, so every route here checks the owner itself.
type SiteHandler struct {
	pylovo  *PylovoHandler
	country countryResolver
	links   buildings3D
	models  siteModels
}

// NewSiteHandler returns a SiteHandler that reaches pylovo through h.
func NewSiteHandler(h *PylovoHandler, country countryResolver, links buildings3D, models siteModels) *SiteHandler {
	return &SiteHandler{pylovo: h, country: country, links: links, models: models}
}

type createSiteRequest struct {
	Name string          `json:"name" binding:"required"`
	Geom json.RawMessage `json:"geom" binding:"required"`
}

// CreateSite creates a site for the caller from a polygon. Its buildings are
// the 3D buildings in the polygon, plus the OSM outlines no 3D building covers.
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

	count, revision, err := s.buildFromFootprints(ctx, siteID, countryName, geom)
	if err != nil {
		s.discard(ctx, siteID)
		httputil.ErrorResponse(c, http.StatusUnprocessableEntity, err.Error())
		return
	}
	site["building_count"] = count
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

// DeleteSite deletes one of the caller's sites with its grid results, unless
// a saved model still uses it: that model's grid would then be gone.
func (s *SiteHandler) DeleteSite(c *gin.Context) {
	id, _, ok := s.ownedSite(c)
	if !ok {
		return
	}
	titles, err := s.models.ModelsUsingSite(id)
	if err != nil {
		logger.ForComponent("pylovo").Errorf("list models using site %d: %v", id, err)
		httputil.InternalError(c, fmt.Sprintf("could not check which models use site %d", id))
		return
	}
	if len(titles) > 0 {
		httputil.Conflict(c, fmt.Sprintf("site %d is the grid of %d saved model(s): %s; delete those models or give them another grid first",
			id, len(titles), strings.Join(titles, ", ")))
		return
	}
	if _, _, ok := s.call(c, http.MethodDelete, fmt.Sprintf("/sites/%d", id), nil); ok {
		httputil.NoContent(c)
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
		body, status, ok := s.call(c, http.MethodGet, fmt.Sprintf("/sites/%d/grid", id), nil)
		if !ok {
			return
		}
		keyed, err := keyBuildings3D(body)
		if err != nil {
			httputil.BadGateway(c, fmt.Sprintf("Unreadable grid of site %d from Pylovo: %v", id, err))
			return
		}
		c.JSON(status, gin.H{"success": true, "data": keyed})
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

// buildingExclusion leaves a site building out of the grid or takes it back
// in; OSMID is the building's osm_id in the site grid, a c2t: key for a 3D
// building.
type buildingExclusion struct {
	OSMID    string `json:"osm_id" binding:"required"`
	Excluded bool   `json:"excluded"`
}

// siteBuilding is a building of GET /sites/{id}/buildings with its overrides.
type siteBuilding struct {
	BuildingID int            `json:"building_id"`
	OSMID      *string        `json:"osm_id"`
	Source     string         `json:"source"`
	SourceID   *string        `json:"source_id"`
	Overrides  map[string]any `json:"overrides"`
}

// key is the building's osm_id as the site grid shows it (see keyBuildings3D).
func (b siteBuilding) key() string {
	if b.Source == "city2tabula" && b.SourceID != nil {
		return city2tabula.ObjectKey(*b.SourceID)
	}
	if b.OSMID != nil {
		return *b.OSMID
	}
	return ""
}

// PatchSiteBuildings sets which of the site's buildings are left out of its
// grid. pylovo's PATCH replaces a building's overrides as a whole, so each
// building's other overrides are read first and sent back unchanged. Excluding
// a building the site does not hold changes nothing; including one is refused.
// The answer carries the site's revision after the change.
func (s *SiteHandler) PatchSiteBuildings(c *gin.Context) {
	var exclusions []buildingExclusion
	if err := c.ShouldBindJSON(&exclusions); err != nil || len(exclusions) == 0 {
		httputil.BadRequest(c, fmt.Sprintf("expected a non-empty JSON array of {osm_id, excluded}: %v", err))
		return
	}
	id, site, ok := s.ownedSite(c)
	if !ok {
		return
	}
	body, _, ok := s.call(c, http.MethodGet, fmt.Sprintf("/sites/%d/buildings", id), nil)
	if !ok {
		return
	}
	var list struct {
		Features []struct {
			Properties siteBuilding `json:"properties"`
		} `json:"features"`
	}
	if err := json.Unmarshal(body, &list); err != nil {
		httputil.BadGateway(c, fmt.Sprintf("Unreadable buildings of site %d from Pylovo: %v", id, err))
		return
	}
	byKey := make(map[string]siteBuilding, len(list.Features))
	for _, f := range list.Features {
		byKey[f.Properties.key()] = f.Properties
	}
	patches, unknown := exclusionPatches(exclusions, byKey)
	if len(unknown) > 0 {
		httputil.BadRequest(c, fmt.Sprintf("site %d holds no building %s to include", id, strings.Join(unknown, ", ")))
		return
	}
	if len(patches) == 0 {
		httputil.SuccessResponse(c, gin.H{"revision": site["revision"]})
		return
	}
	payload, err := json.Marshal(patches)
	if err != nil {
		httputil.InternalError(c, errFailedMarshalPayload)
		return
	}
	s.relay(c, http.MethodPatch, fmt.Sprintf("/sites/%d/buildings", id), payload)
}

// exclusionPatches turns exclusions into pylovo building patches that keep
// each building's other overrides. It skips excluding a building no key
// names, and returns the keys of buildings to include that no building has.
func exclusionPatches(exclusions []buildingExclusion, byKey map[string]siteBuilding) ([]map[string]any, []string) {
	patches := make([]map[string]any, 0, len(exclusions))
	var unknown []string
	for _, e := range exclusions {
		b, found := byKey[e.OSMID]
		if !found {
			if !e.Excluded {
				unknown = append(unknown, e.OSMID)
			}
			continue
		}
		overrides := map[string]any{}
		for k, v := range b.Overrides {
			overrides[k] = v
		}
		overrides["excluded"] = e.Excluded
		patches = append(patches, map[string]any{"building_id": b.BuildingID, "overrides": overrides})
	}
	return patches, unknown
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
