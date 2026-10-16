package buem

import (
	"fmt"
	"net/http"

	"github.com/gin-gonic/gin"

	"platform.local/common/pkg/httputil"

	"spatialhub_backend/internal/api/contracts"
	buemclient "spatialhub_backend/internal/buem"
	"spatialhub_backend/internal/contenthash"
	"spatialhub_backend/internal/demand"
	backendModels "spatialhub_backend/internal/models"
	seriesstore "spatialhub_backend/internal/store/series"
)

// draftRevision is the revision of a draft's links; a draft has no saved
// config to hash, and links move to the model's revision when it is saved.
const draftRevision = "draft"

// RunModelBuilding godoc
//
//	@Summary		Run BuEM for one building of a model and store the result
//	@Description	Runs the building with the block the caller supplies, as POST /v1/buem/building
//	@Description	does, then stores the result once under its request key and links it to the
//	@Description	building as source user. A request whose key is already stored makes no BuEM call.
//	@Description	Returns the building's demand summary. Needs edit permission on the model.
//	@Tags			BuEM
//	@Accept			json
//	@Produce		json
//	@Param			id				path		int									true	"Model ID"
//	@Param			building_ref	path		string								true	"Building OSM id, or c2t:<object_id>"
//	@Param			request			body		contracts.BuemBuildingRunRequest	true	"Building geometry and BuEM building block"
//	@Success		200	{object}	contracts.BuildingDemandProfileResponse
//	@Failure		400	{object}	contracts.ErrorResponse
//	@Failure		403	{object}	contracts.ErrorResponse
//	@Failure		404	{object}	contracts.ErrorResponse
//	@Failure		502	{object}	contracts.ErrorResponse
//	@Security		SessionAuth
//	@Router			/models/{id}/buildings/{building_ref}/buem [post]
func (h *Handler) RunModelBuilding(c *gin.Context) {
	model, ok := h.models.EditableModel(c, c.Param("id"))
	if !ok {
		return
	}
	revision, err := contenthash.Of(model.Config)
	if err != nil {
		httputil.InternalError(c, fmt.Sprintf("failed to hash the config of model %d: %v", model.ID, err))
		return
	}
	h.runStored(c, seriesstore.Owner{ModelID: model.ID}, revision, fmt.Sprint(model.ID))
}

// RunDraftBuilding godoc
//
//	@Summary		Run BuEM for one building of an unsaved model and store the result
//	@Description	As the model route, for a model not saved yet. The result is linked to the draft
//	@Description	and moves to the model when it is saved (POST /models/{id}/series/claim-draft).
//	@Tags			BuEM
//	@Accept			json
//	@Produce		json
//	@Param			draft_id		path		string								true	"Draft id the frontend created for the unsaved model"
//	@Param			building_ref	path		string								true	"Building OSM id, or c2t:<object_id>"
//	@Param			request			body		contracts.BuemBuildingRunRequest	true	"Building geometry and BuEM building block"
//	@Success		200	{object}	contracts.BuildingDemandProfileResponse
//	@Failure		400	{object}	contracts.ErrorResponse
//	@Failure		502	{object}	contracts.ErrorResponse
//	@Security		SessionAuth
//	@Router			/drafts/{draft_id}/buildings/{building_ref}/buem [post]
func (h *Handler) RunDraftBuilding(c *gin.Context) {
	draftID := c.Param("draft_id")
	if draftID == "" || len(draftID) > 255 {
		httputil.BadRequest(c, fmt.Sprintf("draft id %q must be 1 to 255 characters", draftID))
		return
	}
	h.runStored(c, seriesstore.Owner{DraftID: draftID}, draftRevision, draftID)
}

// runStored runs or reuses the building's result, links it to owner and
// answers with the building's demand summary.
func (h *Handler) runStored(c *gin.Context, owner seriesstore.Owner, revision, ownerID string) {
	if h.buemVersion == "" {
		httputil.InternalError(c, "BUEM_VERSION is not configured on the backend, so results cannot be stored")
		return
	}
	p, ok := h.prepare(c)
	if !ok {
		return
	}
	ref := c.Param("building_ref")
	if p.req.OSMID != "" && p.req.OSMID != ref {
		httputil.BadRequest(c, fmt.Sprintf("osm_id %q does not match building %q in the path", p.req.OSMID, ref))
		return
	}
	p.building.ID = ref
	id, ok := h.reuseOrRun(c, p, ownerID)
	if !ok {
		return
	}
	h.linkAndRespond(c, owner, revision, ref, id)
}

// reuseOrRun returns the profile id stored under the building's request key,
// running BuEM and storing the result only when the key is new.
func (h *Handler) reuseOrRun(c *gin.Context, p prepared, ownerID string) (int64, bool) {
	shared, err := buemclient.NewSharedInputs(p.weather, p.start, p.end, p.req.Resolution, h.buemVersion)
	if err != nil {
		httputil.InternalError(c, err.Error())
		return 0, false
	}
	key, err := buemclient.RequestKey(p.building, shared)
	if err != nil {
		httputil.BadRequest(c, err.Error())
		return 0, false
	}
	stored, err := h.series.StoredKeys([]string{key})
	if err != nil {
		httputil.InternalError(c, err.Error())
		return 0, false
	}
	if id, ok := stored[key]; ok {
		return id, true
	}
	result, ok := h.run(c, p, ownerID)
	if !ok {
		return 0, false
	}
	id, reason := demand.StoreResult(result, key, h.buemVersion, h.series)
	if reason != "" {
		httputil.BadGateway(c, "BuEM result not stored: "+reason)
		return 0, false
	}
	return id, true
}

// linkAndRespond links every series of profile id to the building as source
// user, then answers with the building's demand summary.
func (h *Handler) linkAndRespond(c *gin.Context, owner seriesstore.Owner, revision, ref string, id int64) {
	profiles, err := h.series.Profiles([]int64{id})
	if err != nil {
		httputil.InternalError(c, err.Error())
		return
	}
	var links []seriesstore.Link
	for _, name := range profiles[id].SeriesNames {
		links = append(links, seriesstore.Link{BuildingRef: ref, Series: name, ProfileID: id, Source: backendModels.SeriesSourceUser})
	}
	if err := h.series.Link(owner, revision, links); err != nil {
		httputil.InternalError(c, err.Error())
		return
	}
	linked, err := h.series.LinkedSeries(owner, ref)
	if err != nil {
		httputil.InternalError(c, err.Error())
		return
	}
	summaries, err := demand.Summaries(linked)
	if err != nil {
		httputil.InternalError(c, err.Error())
		return
	}
	c.JSON(http.StatusOK, contracts.BuildingDemandProfileResponse{BuildingRef: ref, Series: summaries})
}
