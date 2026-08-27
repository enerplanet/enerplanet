package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/hibiken/asynq"
	"github.com/sirupsen/logrus"
	"gorm.io/gorm"

	commonModels "platform.local/common/pkg/models"
	"platform.local/platform/logger"
	"spatialhub_backend/internal/buem"
	"spatialhub_backend/internal/city2tabula"
	"spatialhub_backend/internal/geo"
	"spatialhub_backend/internal/payload"
	"spatialhub_backend/internal/services"
	"spatialhub_backend/internal/weather"
)

const TypeRunBuem = "run_buem"

const (
	runPollInterval = 5 * time.Second
	runPollTimeout  = 10 * time.Minute
)

// envelopeTypeByClassname maps City2TABULA's CityGML surface classnames onto
// BuEM's own envelope_element "type" vocabulary (buem-gateway's
// request_schema.json). Classnames with no entry (e.g. ClosureSurface) are
// skipped rather than guessed.
var envelopeTypeByClassname = map[string]string{
	"WallSurface":   "wall",
	"RoofSurface":   "roof",
	"GroundSurface": "floor",
}

// RunBuemPayload mirrors the shape StartCalculation already builds for
// "dispatch_model_calculation" (see model_service_calculation.go) — reusing
// payload.CalculationPayload directly means no separate wire format to keep
// in sync.
type RunBuemPayload struct {
	ModelID uint                       `json:"model_id"`
	UserID  string                     `json:"user_id"`
	Payload payload.CalculationPayload `json:"payload"`
}

// HandleRunBuem runs before "dispatch_model_calculation": it resolves 3D
// envelope data (City2TABULA) and weather (weather-serve) for whatever
// buildings in the topology it can, calls buem-gateway synchronously so BuEM
// writes its load-profile CSVs, then enqueues "dispatch_model_calculation"
// exactly as StartCalculation used to do directly. City2TABULA/weather-serve
// resolution here is a temporary stand-in for Orchestrator's future
// dependency-resolution role — see the on-request-3d-pipeline plan.
func HandleRunBuem(
	ctx context.Context,
	t *asynq.Task,
	db *gorm.DB,
	c2t *city2tabula.Client,
	wx *weather.Client,
	weatherProvider string,
	buemClient *buem.Client,
	asynqClient *asynq.Client,
	notificationService *services.NotificationService,
) (retErr error) {
	log := logger.ForComponent("job:run_buem")

	defer func() {
		if r := recover(); r != nil {
			log.Errorf("PANIC in HandleRunBuem: %v", r)
			retErr = fmt.Errorf("panic in run_buem: %v", r)
		}
	}()

	var rp RunBuemPayload
	if err := json.Unmarshal(t.Payload(), &rp); err != nil {
		return fmt.Errorf("failed to unmarshal payload: %w", err)
	}

	var model commonModels.Model
	if err := db.First(&model, rp.ModelID).Error; err != nil {
		return fmt.Errorf("failed to fetch model %d: %w", rp.ModelID, err)
	}

	// StartCalculation enqueues this job right after setting status to
	// queue; anything else means a duplicate delivery or a stale retry.
	if model.Status != commonModels.ModelStatusQueue {
		log.Debugf("model %d not in queue status (status=%s), skipping run_buem", rp.ModelID, model.Status)
		return nil
	}

	envelopeByOSMID, weatherJSON := resolveBuemInputs(ctx, log, c2t, wx, weatherProvider, model, rp.Payload)

	buildings := buildingsForBuem(rp.Payload.Topology, envelopeByOSMID)
	if len(buildings) == 0 || len(weatherJSON) == 0 {
		log.Warnf("model %d: no buildings with a resolved envelope and weather, skipping buem-gateway call", rp.ModelID)
	} else {
		results, err := buemClient.RunBuildings(ctx, buildings, weatherJSON, rp.Payload.StartDate, rp.Payload.EndDate, rp.Payload.Resolution, rp.Payload.ModelID)
		if err != nil {
			return failRunBuem(ctx, db, log, notificationService, model, rp, fmt.Errorf("buem-gateway call failed: %w", err))
		}
		mergeBuemResults(log, rp.Payload.Topology, results)
	}

	if err := enqueueDispatchModelCalculation(asynqClient, rp); err != nil {
		return failRunBuem(ctx, db, log, notificationService, model, rp, err)
	}

	return nil
}

// resolveBuemInputs fetches envelope and weather data for model's area.
// Both degrade to nil (envelope/weather simply omitted, not a job failure)
// on any resolution problem — see the plan's "no-3D-data fallback" decision.
func resolveBuemInputs(ctx context.Context, log *logrus.Entry, c2t *city2tabula.Client, wx *weather.Client, provider string, model commonModels.Model, p payload.CalculationPayload) (map[string]city2tabula.Building, json.RawMessage) {
	if model.Country == nil || len(model.Coordinates) == 0 {
		log.Warnf("model %d missing country or coordinates, skipping envelope/weather", model.ID)
		return nil, nil
	}
	country := *model.Country

	xmin, ymin, xmax, ymax, err := geo.BBoxFromGeoJSON(json.RawMessage(model.Coordinates))
	if err != nil {
		log.Warnf("model %d: failed to derive bbox from coordinates, skipping envelope/weather: %v", model.ID, err)
		return nil, nil
	}
	bbox := city2tabula.Bbox{Xmin: xmin, Ymin: ymin, Xmax: xmax, Ymax: ymax}

	envelope := resolveEnvelope(ctx, log, c2t, country, bbox, p.Topology)
	weatherJSON := resolveWeather(ctx, log, wx, provider, model, bbox)
	return envelope, weatherJSON
}

func resolveEnvelope(ctx context.Context, log *logrus.Entry, c2t *city2tabula.Client, country string, bbox city2tabula.Bbox, topology []interface{}) map[string]city2tabula.Building {
	osmIDs := buildingOSMIDs(topology)
	if len(osmIDs) == 0 {
		return nil
	}

	byOSMID, err := fetchLinkedBuildings(ctx, c2t, country, osmIDs)
	if err != nil {
		log.Warnf("city2tabula building fetch failed, proceeding without envelope data: %v", err)
		return nil
	}

	// A bbox-level coverage count can't distinguish "some of this area was
	// processed before" from "all of it was" — two users' overlapping-but-
	// different polygons is exactly that case, and would otherwise leave
	// buildings only in the new sliver unprocessed. Checking against the
	// topology's own osm_ids is precise: it only re-runs the pipeline when a
	// building this calculation actually needs is still unlinked.
	missing := missingOSMIDs(osmIDs, byOSMID)
	if len(missing) == 0 {
		return byOSMID
	}

	run, err := c2t.TriggerRun(ctx, country, bbox)
	if err != nil {
		log.Warnf("city2tabula run trigger failed, proceeding with %d/%d buildings resolved: %v", len(byOSMID), len(osmIDs), err)
		return byOSMID
	}
	if err := pollRunStatus(ctx, c2t, run.RunID); err != nil {
		log.Warnf("city2tabula run did not complete, proceeding with %d/%d buildings resolved: %v", len(byOSMID), len(osmIDs), err)
		return byOSMID
	}

	byOSMID, err = fetchLinkedBuildings(ctx, c2t, country, osmIDs)
	if err != nil {
		log.Warnf("city2tabula building re-fetch after run failed, proceeding without envelope data: %v", err)
		return nil
	}
	return byOSMID
}

// fetchLinkedBuildings fetches osmIDs' 3D attributes and indexes them by
// osm_id. An osm_id absent from the result has no PyLovo-linked building in
// City2TABULA yet — see missingOSMIDs.
func fetchLinkedBuildings(ctx context.Context, c2t *city2tabula.Client, country string, osmIDs []string) (map[string]city2tabula.Building, error) {
	buildings, err := c2t.GetBuildingsByOSMIDs(ctx, country, osmIDs)
	if err != nil {
		return nil, err
	}
	byOSMID := make(map[string]city2tabula.Building, len(buildings))
	for _, b := range buildings {
		if b.OSMID != "" {
			byOSMID[b.OSMID] = b
		}
	}
	return byOSMID, nil
}

// missingOSMIDs returns the osm_ids in want that have no entry in got.
func missingOSMIDs(want []string, got map[string]city2tabula.Building) []string {
	var missing []string
	for _, id := range want {
		if _, ok := got[id]; !ok {
			missing = append(missing, id)
		}
	}
	return missing
}

func pollRunStatus(ctx context.Context, c2t *city2tabula.Client, runID string) error {
	deadline := time.Now().Add(runPollTimeout)
	for time.Now().Before(deadline) {
		run, err := c2t.GetRunStatus(ctx, runID)
		if err != nil {
			return err
		}
		switch run.Status {
		case "completed":
			return nil
		case "no_data", "failed":
			return fmt.Errorf("city2tabula run %s ended with status %s: %s", runID, run.Status, run.Error)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(runPollInterval):
		}
	}
	return fmt.Errorf("city2tabula run %s did not complete within %s", runID, runPollTimeout)
}

// resolveWeather fetches one point-weather timeseries for the bbox centroid
// and model.FromDate's year, shared across every building — not a per
// building fetch. Buildings in one model's area of interest are close enough
// that a single point is a reasonable stand-in; splitting per building is a
// straightforward upgrade if that stops holding.
func resolveWeather(ctx context.Context, log *logrus.Entry, wx *weather.Client, provider string, model commonModels.Model, bbox city2tabula.Bbox) json.RawMessage {
	lat := (bbox.Ymin + bbox.Ymax) / 2
	lon := (bbox.Xmin + bbox.Xmax) / 2

	body, err := wx.GetPointWeather(ctx, lat, lon, model.FromDate.Year(), provider)
	if err != nil {
		log.Warnf("weather-serve request failed, proceeding without weather data: %v", err)
		return nil
	}
	return body
}

// buildingOSMIDs collects the distinct osm_id of every BasePOI (building)
// node in topology — transformer nodes carry a non-numeric synthetic osm_id
// (see createTopologyNode) and are excluded by the feature_type check.
func buildingOSMIDs(topology []interface{}) []string {
	seen := make(map[string]bool)
	var ids []string
	for _, entry := range topology {
		e, ok := entry.(map[string]interface{})
		if !ok {
			continue
		}
		for _, key := range []string{"from", "to"} {
			if _, osmID, ok := buildingProperties(e[key]); ok && !seen[osmID] {
				seen[osmID] = true
				ids = append(ids, osmID)
			}
		}
	}
	return ids
}

// buildingProperties returns feature's properties map and osm_id if feature
// is a building (BasePOI) node with a non-empty osm_id.
func buildingProperties(feature interface{}) (props map[string]interface{}, osmID string, ok bool) {
	f, ok := feature.(map[string]interface{})
	if !ok {
		return nil, "", false
	}
	props, ok = f["properties"].(map[string]interface{})
	if !ok || props["feature_type"] != "BasePOI" {
		return nil, "", false
	}
	osmID, _ = props["osm_id"].(string)
	if osmID == "" {
		return nil, "", false
	}
	return props, osmID, true
}

// buildingsForBuem collects one buem.Building per topology node with a
// resolved envelope — buem-gateway has no concept of a topology, so this is
// where that graph gets resolved down to the flat list its buildings
// endpoint takes. A node whose osm_id has no entry in envelopeByOSMID (no
// PyLovo-linked 3D data) is left out rather than sent with an empty
// envelope, since buem-gateway would just reject it anyway. weather is not
// attached here — it is sent once, shared across the whole request, by the
// caller of RunBuildings.
func buildingsForBuem(topology []interface{}, envelopeByOSMID map[string]city2tabula.Building) []buem.Building {
	var buildings []buem.Building
	seen := make(map[string]bool)
	for _, entry := range topology {
		e, ok := entry.(map[string]interface{})
		if !ok {
			continue
		}
		for _, key := range []string{"from", "to"} {
			b, ok := buildingForBuem(e[key], envelopeByOSMID, seen)
			if !ok {
				continue
			}
			buildings = append(buildings, b)
		}
	}
	return buildings
}

// buildingForBuem builds one buem.Building from a single topology node, or
// reports false if feature isn't a building with a resolved, non-empty
// envelope, or its osm_id was already collected (a building can appear on
// both sides of more than one grid edge).
func buildingForBuem(feature interface{}, envelopeByOSMID map[string]city2tabula.Building, seen map[string]bool) (buem.Building, bool) {
	node, ok := feature.(map[string]interface{})
	if !ok {
		return buem.Building{}, false
	}
	_, osmID, ok := buildingProperties(feature)
	if !ok || seen[osmID] {
		return buem.Building{}, false
	}
	cityBuilding, ok := envelopeByOSMID[osmID]
	if !ok {
		return buem.Building{}, false
	}
	elements := envelopeElements(cityBuilding)
	if len(elements) == 0 {
		return buem.Building{}, false
	}
	geometry, err := json.Marshal(node["geometry"])
	if err != nil {
		return buem.Building{}, false
	}
	buildingBlock, err := json.Marshal(map[string]interface{}{
		"envelope": map[string]interface{}{"elements": elements},
	})
	if err != nil {
		return buem.Building{}, false
	}

	seen[osmID] = true
	return buem.Building{ID: osmID, Geometry: geometry, Building: buildingBlock}, true
}

// mergeBuemResults writes each successful result's enriched buem block onto
// its matching topology node's properties.buem, keyed by osm_id — the same
// key buildingsForBuem used to build the request. A building with no result,
// or one whose result carries an Error, keeps no buem block; the
// calculation dispatch downstream already degrades gracefully for a
// building missing envelope data.
func mergeBuemResults(log *logrus.Entry, topology []interface{}, results []buem.BuildingResult) {
	byID := make(map[string]buem.BuildingResult, len(results))
	var failed int
	for _, r := range results {
		if r.Error != "" || len(r.BUEM) == 0 {
			failed++
			continue
		}
		byID[r.ID] = r
	}
	if failed > 0 {
		log.Warnf("buem-gateway: %d/%d buildings had no result (missing envelope/weather, or BuEM rejected them)", failed, len(results))
	}
	if len(byID) == 0 {
		return
	}

	for _, entry := range topology {
		e, ok := entry.(map[string]interface{})
		if !ok {
			continue
		}
		for _, key := range []string{"from", "to"} {
			props, osmID, ok := buildingProperties(e[key])
			if !ok {
				continue
			}
			result, ok := byID[osmID]
			if !ok {
				continue
			}
			var buemData interface{}
			if err := json.Unmarshal(result.BUEM, &buemData); err != nil {
				continue
			}
			props["buem"] = buemData
		}
	}
}

// envelopeElements maps City2TABULA's per-surface geometry onto BuEM's
// envelope_element schema. Surfaces with an unmapped type, or that
// City2TABULA flagged invalid/non-planar, or missing area/azimuth/tilt, are
// left out rather than sent with placeholder geometry.
func envelopeElements(building city2tabula.Building) []map[string]interface{} {
	var elements []map[string]interface{}
	for _, s := range building.Surfaces {
		elemType, ok := envelopeTypeByClassname[s.Type]
		if !ok {
			continue
		}
		if s.IsValid != nil && !*s.IsValid {
			continue
		}
		if s.IsPlanar != nil && !*s.IsPlanar {
			continue
		}
		if s.AreaSqm == nil || s.Azimuth == nil || s.Tilt == nil {
			continue
		}

		azimuth := *s.Azimuth
		if azimuth < 0 {
			// City2TABULA uses -1 for near-horizontal surfaces with no
			// meaningful orientation; BuEM's schema requires [0,360], so
			// undefined becomes 0 (non-directional) rather than -1.
			azimuth = 0
		}

		elements = append(elements, map[string]interface{}{
			"id":      s.ID,
			"type":    elemType,
			"area":    map[string]interface{}{"value": *s.AreaSqm, "unit": "m2"},
			"azimuth": map[string]interface{}{"value": azimuth, "unit": "deg"},
			// City2TABULA: 0=vertical wall, 90=flat roof — the opposite of
			// BuEM's 0=horizontal roof, 90=vertical wall.
			"tilt": map[string]interface{}{"value": 90 - *s.Tilt, "unit": "deg"},
		})
	}
	return elements
}

func failRunBuem(ctx context.Context, db *gorm.DB, log *logrus.Entry, notificationService *services.NotificationService, model commonModels.Model, rp RunBuemPayload, cause error) error {
	log.Errorf("run_buem failed for model_id=%d: %v", rp.ModelID, cause)

	now := time.Now().UTC()
	_ = db.Model(&commonModels.Model{}).Where("id = ?", rp.ModelID).Updates(map[string]interface{}{
		"status":                   commonModels.ModelStatusFailed,
		"calculation_completed_at": now,
		"updated_at":               now,
		"results": map[string]interface{}{
			"error": fmt.Sprintf("BuEM run failed: %v", cause),
		},
	}).Error

	if notificationService != nil {
		if err := notificationService.SendModelCompletionNotification(ctx, rp.UserID, model.UserEmail, model.Title, rp.ModelID, "failed"); err != nil {
			log.Errorf("failed to send failure notification model_id=%d err=%v", rp.ModelID, err)
		}
	}

	return fmt.Errorf("run_buem failed for model_id=%d: %w", rp.ModelID, cause)
}

// enqueueDispatchModelCalculation enqueues the same "dispatch_model_calculation"
// task StartCalculation used to enqueue directly, with rp.Payload's topology
// now possibly enriched with buem blocks.
func enqueueDispatchModelCalculation(asynqClient *asynq.Client, rp RunBuemPayload) error {
	type taskPayload struct {
		ModelID uint        `json:"model_id"`
		UserID  string      `json:"user_id"`
		Payload interface{} `json:"payload"`
	}

	payloadBytes, err := json.Marshal(taskPayload{
		ModelID: rp.ModelID,
		UserID:  rp.UserID,
		Payload: rp.Payload,
	})
	if err != nil {
		return fmt.Errorf("failed to marshal dispatch_model_calculation payload: %w", err)
	}

	task := asynq.NewTask("dispatch_model_calculation", payloadBytes)
	_, err = asynqClient.Enqueue(task,
		asynq.Queue("spatialAI_public"),
		asynq.MaxRetry(100),
		asynq.Timeout(24*time.Hour),
		asynq.Retention(24*time.Hour),
	)
	if err != nil {
		return fmt.Errorf("failed to enqueue dispatch_model_calculation: %w", err)
	}
	return nil
}
