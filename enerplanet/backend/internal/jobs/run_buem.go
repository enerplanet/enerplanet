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
	"spatialhub_backend/internal/heatdemand"
	"spatialhub_backend/internal/ignis"
	"spatialhub_backend/internal/payload"
	"spatialhub_backend/internal/services"
	"spatialhub_backend/internal/weather"
)

const TypeRunBuem = "run_buem"

const (
	runPollInterval = 5 * time.Second
	runPollTimeout  = 10 * time.Minute
)

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
// exactly as StartCalculation used to do directly. U-values are resolved at
// the model's configured refurbishment level (config.refurbishmentLevel,
// per-building override on top - see modelRefurbishmentLevel), so the
// simulated demand itself reflects the chosen scenario, not just the
// resolve_demand_profiles display.
// Envelope and weather resolution here is a temporary stand-in for a future
// Orchestrator layer's dependency-resolution role; every outbound leg
// (City2TABULA, weather-serve, ignis, buem-gateway) routes through TentaCron.
func HandleRunBuem(
	ctx context.Context,
	t *asynq.Task,
	db *gorm.DB,
	c2t *city2tabula.Client,
	wx *weather.Client,
	weatherProvider string,
	buemClient *buem.Client,
	ignisClient *ignis.Client,
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

	results, _, _, err := ResolveBuemForModel(ctx, log, c2t, wx, weatherProvider, ignisClient, buemClient, model, rp.Payload, modelRefurbishmentLevel(model.Config))
	if err != nil {
		return failRunBuem(ctx, db, log, notificationService, model, rp, fmt.Errorf("buem-gateway call failed: %w", err))
	}
	mergeBuemResults(log, rp.Payload.Topology, results)

	if err := enqueueDispatchModelCalculation(asynqClient, rp); err != nil {
		return failRunBuem(ctx, db, log, notificationService, model, rp, err)
	}

	return nil
}

// ResolveBuemForModel resolves 3D envelope + weather data for model's area,
// attaches TABULA U-values (at refurbishmentLevel, per-building overrides
// applied on top) to every buildable topology node, and calls buem-gateway.
// Shared by HandleRunBuem (a full model calculation) and
// HandleResolveDemandProfiles (the standalone per-building profile resolution
// triggered from UpdateModel), so there is one implementation of this
// pipeline. resolved/unresolved are always populated, even when the
// buem-gateway call itself is skipped or fails, so a caller that persists
// per-building outcomes still learns which buildings had no envelope at all.
func ResolveBuemForModel(
	ctx context.Context,
	log *logrus.Entry,
	c2t *city2tabula.Client,
	wx *weather.Client,
	weatherProvider string,
	ignisClient envelopeUValueResolver,
	buemClient *buem.Client,
	model commonModels.Model,
	p payload.CalculationPayload,
	refurbishmentLevel ignis.RefurbishmentLevel,
) (results []buem.BuildingResult, resolved map[string]BuemResolutionMeta, unresolved map[string]string, err error) {
	envelopeByOSMID, weatherJSON := resolveBuemInputs(ctx, log, c2t, wx, weatherProvider, model, p)

	country := ""
	if model.Country != nil {
		country = *model.Country
	}
	buildings, resolved, unresolved := buildingsForBuem(ctx, ignisClient, country, p.Topology, envelopeByOSMID, refurbishmentLevel, modelCookingSettings(model.Config))
	if len(buildings) == 0 || len(weatherJSON) == 0 {
		log.Warnf("model %d: no buildings with a resolved envelope and weather, skipping buem-gateway call", model.ID)
		return nil, resolved, unresolved, nil
	}

	results, err = buemClient.RunBuildings(ctx, buildings, weatherJSON, p.StartDate, p.EndDate, p.Resolution, p.ModelID)
	if err != nil {
		return nil, resolved, unresolved, err
	}
	return results, resolved, unresolved, nil
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
//
// resolved maps each returned building's osm_id to the TABULA variant/level
// that produced its U-values; unresolved maps a building node's osm_id (one
// that IS a building, unlike a transformer node) to why it could not be sent.
// Both exist for callers that persist per-building outcomes (see
// HandleResolveDemandProfiles); HandleRunBuem's calculation-dispatch path
// ignores them, same behaviour as before this was split out.
func buildingsForBuem(ctx context.Context, ignisClient envelopeUValueResolver, country string, topology []interface{}, envelopeByOSMID map[string]city2tabula.Building, defaultLevel ignis.RefurbishmentLevel, defaultCooking cookingSettings) (buildings []buem.Building, resolved map[string]BuemResolutionMeta, unresolved map[string]string) {
	resolved = make(map[string]BuemResolutionMeta)
	unresolved = make(map[string]string)
	seen := make(map[string]bool)
	for _, entry := range topology {
		e, ok := entry.(map[string]interface{})
		if !ok {
			continue
		}
		for _, key := range []string{"from", "to"} {
			feature := e[key]
			props, osmID, isBuilding := buildingProperties(feature)
			if !isBuilding || seen[osmID] {
				continue
			}
			seen[osmID] = true

			node, _ := feature.(map[string]interface{})
			b, meta, reason, ok := buildingForBuem(ctx, ignisClient, country, node, props, osmID, envelopeByOSMID, defaultLevel, defaultCooking)
			if !ok {
				unresolved[osmID] = reason
				continue
			}
			buildings = append(buildings, b)
			resolved[osmID] = meta
		}
	}
	return buildings, resolved, unresolved
}

// buildingForBuem builds one buem.Building for an already-identified building
// node (props/osmID as buildingProperties extracted them), or reports false
// with reason set when it has no resolved, non-empty envelope. meta records
// the TABULA variant/refurbishment level that produced its U-values.
func buildingForBuem(ctx context.Context, ignisClient envelopeUValueResolver, country string, node map[string]interface{}, props map[string]interface{}, osmID string, envelopeByOSMID map[string]city2tabula.Building, defaultLevel ignis.RefurbishmentLevel, defaultCooking cookingSettings) (b buem.Building, meta BuemResolutionMeta, reason string, ok bool) {
	cityBuilding, ok := envelopeByOSMID[osmID]
	if !ok {
		return buem.Building{}, BuemResolutionMeta{}, "no City2TABULA envelope for this building", false
	}
	elements := city2tabula.EnvelopeElements(cityBuilding)
	if len(elements) == 0 {
		return buem.Building{}, BuemResolutionMeta{}, "City2TABULA returned no usable envelope surfaces", false
	}
	fClass, _ := props["f_class"].(string)
	variantCode := ""
	if cityBuilding.TabulaVariantCode != nil {
		variantCode = *cityBuilding.TabulaVariantCode
	}
	level := buildingRefurbishmentLevel(props, defaultLevel)
	elements, meta = attachEnvelopeUValues(ctx, ignisClient, elements, variantCode, fClass, country, buildingConstructionYear(props), level)

	geometry, err := json.Marshal(node["geometry"])
	if err != nil {
		return buem.Building{}, BuemResolutionMeta{}, fmt.Sprintf("failed to marshal geometry: %v", err), false
	}
	// cooking_carrier / include_dhw are building.* fields of buem-gateway's
	// v6-draft request contract; the gateway forwards the building block
	// verbatim and a BuEM without the fields ignores them.
	cooking := buildingCookingSettings(props, defaultCooking)
	block := buildingScalars(cityBuilding)
	// A service class from OSM overrides the TABULA type: City2TABULA's
	// variant code is a geometry match against residential archetypes and
	// says nothing about use, and a residential building_type would put a
	// bakery through BuEM's household occupancy model. The envelope and
	// U-values stay as resolved; only the occupancy profile changes.
	if service := serviceBuildingType(fClass); service != "" {
		block["building_type"] = service
		delete(block, "construction_period")
		if capacity := buildingCapacity(props); capacity != nil {
			block["capacity"] = *capacity
		}
	}
	if bt, _ := block["building_type"].(string); bt != "" {
		meta.BuildingType = bt
	}
	// The TABULA archetype's dwelling count scales BuEM's household model
	// (occupants, hot water, electricity, cooking) for multi-dwelling
	// buildings. 1 is BuEM's default and 0 means ignis has no count, so
	// only a count above one is sent; a service building is not a set of
	// dwellings and never gets one.
	if serviceBuildingType(fClass) == "" && meta.Apartments > 1 {
		block["residential_units"] = meta.Apartments
		meta.ResidentialUnits = meta.Apartments
	}
	block["envelope"] = map[string]interface{}{"elements": elements}
	block["cooking_carrier"] = cooking.Carrier
	block["include_dhw"] = cooking.IncludeDHW
	buildingBlock, err := json.Marshal(block)
	if err != nil {
		return buem.Building{}, BuemResolutionMeta{}, fmt.Sprintf("failed to marshal building block: %v", err), false
	}

	return buem.Building{ID: osmID, Geometry: geometry, Building: buildingBlock}, meta, "", true
}

// buildingConstructionYear reads properties.construction_year, set only once
// a building has been through the heat-demand resolve-and-save flow.
// JSON numbers decode as float64 in a map[string]interface{}.
func buildingConstructionYear(props map[string]interface{}) *int {
	switch v := props["construction_year"].(type) {
	case float64:
		year := int(v)
		return &year
	case int:
		return &v
	default:
		return nil
	}
}

// envelopeUValueResolver is the ignis surface attachEnvelopeUValues needs.
// Satisfied by *ignis.Client; faked in tests.
type envelopeUValueResolver interface {
	heatdemand.VariantResolver
	GetEnvelopeUValuesForLevel(ctx context.Context, existingStateCode string, level ignis.RefurbishmentLevel) (ignis.EnvelopeUValuesResult, error)
}

// BuemResolutionMeta records which TABULA variant code and refurbishment
// level actually produced a building's envelope U-values - Level can differ
// from what was requested when TABULA has no data for it at this specific
// archetype (see ignis.Client.GetEnvelopeUValuesForLevel). Zero value means
// no U-values could be attached at all.
type BuemResolutionMeta struct {
	VariantCode string
	Level       ignis.RefurbishmentLevel
	// BuildingType is the building_type sent to BuEM: a TABULA residential
	// type (SFH/TH/MFH/AB) or a service id such as "bakery"; "" when neither
	// could be determined and BuEM applied its default.
	BuildingType string
	// ResidentialUnits is the archetype's dwelling count sent as
	// building.residential_units, 0 when not sent (unknown, a single
	// dwelling, or a service building).
	ResidentialUnits int
	// Apartments is the raw count ignis reported for the variant (0 =
	// unknown), before the send decision above.
	Apartments int
}

// buildingRefurbishmentLevel returns a building's per-building refurbishment
// override (properties.refurbishment_level, set through the same building-
// properties save flow as construction_year - see createBuildingFeature), or
// modelDefault when unset.
func buildingRefurbishmentLevel(props map[string]interface{}, modelDefault ignis.RefurbishmentLevel) ignis.RefurbishmentLevel {
	if v, ok := props["refurbishment_level"].(string); ok && v != "" {
		return ignis.RefurbishmentLevel(v)
	}
	return modelDefault
}

// attachEnvelopeUValues resolves the building's TABULA variant and sets U on
// its wall/roof/floor elements: BuEM rejects a wall/roof/floor element with no
// U, and City2TABULA carries no U-values of its own to supply one from.
// Only wall/roof/floor get U — no explicit window or door elements are added.
// BuEM synthesizes windows at its default window-to-wall ratio and subtracts
// their area from the wall; it does not also subtract caller-supplied opening
// areas, so adding explicit windows here would double-count transmission.
//
// c2tVariantCode is City2TABULA's own geometry-derived TABULA match. When set
// it is used directly: it already fixes the construction period, so it needs
// no user-entered construction year and is more specific than an f-class
// guess. Only when City2TABULA supplied no code does this fall back to
// resolving a variant from f-class, country and construction year.
//
// Any resolution failure (no City2TABULA code and a fallback that cannot
// resolve — non-residential, no construction year on record, no matching
// archetype — or ignis unreachable) leaves elements unchanged: the building
// reaches buem-gateway exactly as it does today and BuEM rejects it the same
// way, which mergeBuemResults already treats as a building with no result, not
// a job failure.
//
// level selects which TABULA refurbishment scenario to read (existing state,
// or medium/advanced when ignis has one for this archetype - see
// ignis.Client.GetEnvelopeUValuesForLevel). The returned meta records the
// variant code queried and the level actually used, which can differ from
// level when TABULA has no data for the requested one; meta is the zero
// value when no U-values could be attached at all.
func attachEnvelopeUValues(ctx context.Context, ignisClient envelopeUValueResolver, elements []city2tabula.EnvelopeElement, c2tVariantCode, fClass, country string, constructionYear *int, level ignis.RefurbishmentLevel) ([]city2tabula.EnvelopeElement, BuemResolutionMeta) {
	if ignisClient == nil {
		return elements, BuemResolutionMeta{}
	}
	code := c2tVariantCode
	if code == "" {
		resolved, err := heatdemand.ResolveVariant(ctx, ignisClient, fClass, "", country, constructionYear)
		if err != nil {
			return elements, BuemResolutionMeta{}
		}
		code = resolved
	}
	u, err := ignisClient.GetEnvelopeUValuesForLevel(ctx, code, level)
	if err != nil {
		return elements, BuemResolutionMeta{VariantCode: code}
	}
	// BuEM applies no thermal-bridging surcharge, so fold ignis's envelope-level
	// delta into each element's U: sum over elements of delta x area equals
	// ignis's single delta x total-area term.
	type elementInputs struct {
		u, bTrans float64
	}
	byType := map[string]elementInputs{
		"wall":  {u.UWall + u.Bridging, u.BTransWall},
		"roof":  {u.URoof + u.Bridging, u.BTransRoof},
		"floor": {u.UFloor + u.Bridging, u.BTransFloor},
	}
	for i := range elements {
		in, ok := byType[elements[i].Type]
		if !ok {
			continue
		}
		// "W/(m2K)" is the exact spelling buem-gateway's v5 request schema
		// allows for U (enum: W/(m2K), BTU/(h.ft2.F)); BuEM rejects the
		// whole building on any other spelling.
		elements[i].U = &city2tabula.Quantity{Value: in.u, Unit: "W/(m2K)"}
		// b_Transmission is (0,1]. Send it only when it actually reduces the
		// loss (< 1, e.g. ~0.5 for a ground floor); 1.0 and a missing 0 both
		// leave it nil, which is BuEM's default.
		if in.bTrans > 0 && in.bTrans < 1 {
			elements[i].BTransmission = &city2tabula.Quantity{Value: in.bTrans, Unit: "-"}
		}
	}
	return elements, BuemResolutionMeta{VariantCode: code, Level: u.Level, Apartments: u.Apartments}
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
