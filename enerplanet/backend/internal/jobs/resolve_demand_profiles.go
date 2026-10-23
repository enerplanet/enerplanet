package jobs

import (
	"context"
	"encoding/json"
	"fmt"
	"math"
	"strings"

	"github.com/hibiken/asynq"
	"github.com/sirupsen/logrus"
	"gorm.io/gorm"

	commonModels "platform.local/common/pkg/models"
	"platform.local/platform/logger"
	"spatialhub_backend/internal/buem"
	"spatialhub_backend/internal/city2tabula"
	"spatialhub_backend/internal/contenthash"
	"spatialhub_backend/internal/ignis"
	"spatialhub_backend/internal/models"
	"spatialhub_backend/internal/payload"
	"spatialhub_backend/internal/store/demandprofile"
	"spatialhub_backend/internal/store/series"
	"spatialhub_backend/internal/weather"
)

// TypeResolveDemandProfiles is the auto-resolve job's asynq task type. Enqueued
// by UpdateModel/CreateModel whenever a saved config carries a building list
// (see internal/model/handler/model.go), independent of StartCalculation.
const TypeResolveDemandProfiles = "resolve_demand_profiles"

// ResolveDemandProfilesPayload is the resolve_demand_profiles job payload: just a
// model id. Unlike run_buem, this job rebuilds the calculation payload itself
// from the model's current, persisted Config rather than carrying a
// snapshot, since it can fire many times across a model's life.
type ResolveDemandProfilesPayload struct {
	ModelID uint `json:"model_id"`
}

// demandProfileStore is the persistence surface HandleResolveDemandProfiles
// needs. Satisfied by *demandprofile.Store; faked in tests.
type demandProfileStore interface {
	ResetForRun(modelID uint, osmIDs []string, refurbishmentLevel string) error
	SaveResolved(modelID uint, osmID string, p demandprofile.ResolvedProfile) error
	SaveFailed(modelID uint, osmID, reason string) error
	SaveShared(modelID uint, osmID, standing string) error
}

// DemandResolver gives each building of a model its BuEM hourly series:
// stored series are reused by request key, the rest run through BuEM in
// groups. Series are linked to the model; annual totals go to its rows.
// resolve_demand_profiles runs it after a save, and dispatch_meme before it
// reads the series, so a run never starts from series not yet stored.
type DemandResolver struct {
	DB              *gorm.DB
	C2T             *city2tabula.Client
	C2TRuns         city2tabulaRunStore
	Weather         *weather.Client
	WeatherProvider string
	Ignis           *ignis.Client
	BuEM            *buem.Client
	Profiles        demandProfileStore
	Series          seriesStore
	BuemVersion     string
}

// HandleResolveDemandProfiles runs r for the model in t's payload.
//
// A resolution problem (buem-gateway unreachable, no buildings in the
// topology) is recorded on the affected rows and never fails the job itself
// - there is no model status for this job to leave stuck, unlike run_buem.
func HandleResolveDemandProfiles(ctx context.Context, t *asynq.Task, r DemandResolver) (retErr error) {
	log := logger.ForComponent("job:resolve_demand_profiles")

	defer func() {
		if rec := recover(); rec != nil {
			log.Errorf("PANIC in HandleResolveDemandProfiles: %v", rec)
			retErr = fmt.Errorf("panic in resolve_demand_profiles: %v", rec)
		}
	}()

	var rp ResolveDemandProfilesPayload
	if err := json.Unmarshal(t.Payload(), &rp); err != nil {
		return fmt.Errorf("failed to unmarshal payload: %w", err)
	}
	_, err := r.Resolve(ctx, rp.ModelID)
	return err
}

// Resolve resolves and links the series of every building of model modelID
// and returns its further ways (see buemRun.further), which have no series of
// their own because their building's heat is resolved under its best way.
func (r DemandResolver) Resolve(ctx context.Context, modelID uint) (map[string]string, error) {
	log := logger.ForComponent("job:resolve_demand_profiles")

	var model commonModels.Model
	if err := r.DB.First(&model, modelID).Error; err != nil {
		return nil, fmt.Errorf("failed to fetch model %d: %w", modelID, err)
	}

	if ModelHeatSource(model.Config) == HeatSourceEstimate {
		log.Debugf("model %d: heatSource=estimate, no demand profiles to resolve", modelID)
		return nil, nil
	}

	calcPayload, err := buildCalculationPayload(&model)
	if err != nil {
		log.Debugf("model %d: cannot build calculation payload, nothing to resolve: %v", modelID, err)
		return nil, nil
	}

	osmIDs := buildingOSMIDs(calcPayload.Topology)
	if len(osmIDs) == 0 {
		log.Debugf("model %d: no buildings in topology, nothing to resolve", modelID)
		return nil, nil
	}

	refurbLevel := modelRefurbishmentLevel(model.Config)
	if err := r.Profiles.ResetForRun(modelID, osmIDs, string(refurbLevel)); err != nil {
		return nil, fmt.Errorf("failed to reset demand profile rows for model %d: %w", modelID, err)
	}
	revision, err := contenthash.Of(model.Config)
	if err != nil {
		return nil, fmt.Errorf("hash config of model %d: %w", modelID, err)
	}
	run := prepareBuemRun(ctx, log, r.C2T, r.C2TRuns, r.Weather, r.WeatherProvider, r.Ignis, model, calcPayload, refurbLevel)
	saveFailures(log, r.Profiles, modelID, run.unresolved)
	for osmID, standing := range run.further {
		if err := r.Profiles.SaveShared(modelID, osmID, standing); err != nil {
			log.Errorf("model %d osm_id=%s: failed to record it as shared: %v", modelID, osmID, err)
		}
	}
	if len(run.buildings) == 0 {
		return run.further, nil
	}
	if r.BuemVersion == "" {
		log.Errorf("model %d: BUEM_VERSION is not configured, BuEM results cannot be keyed", modelID)
		saveFailures(log, r.Profiles, modelID, allFailed(run.buildings, "BUEM_VERSION is not configured on the backend"))
		return run.further, nil
	}
	return run.further, resolveAndLink(ctx, log, r.DB, modelID, revision, run, calcPayload, r.BuemVersion, r.BuEM, r.Profiles, r.Series)
}

// resolveAndLink stores every building's series, then links them and fills
// the demand profile rows, unless the model changed while BuEM ran: a newer
// run then links its own results, and these stay stored for reuse.
func resolveAndLink(ctx context.Context, log *logrus.Entry, db *gorm.DB, modelID uint, revision string, run buemRun, p payload.CalculationPayload, buemVersion string, runner groupRunner, profileStore demandProfileStore, store seriesStore) error {
	outcome, err := resolveSeries(ctx, log, run, p.Resolution, p.ModelID, buemVersion, store, runner)
	if err != nil {
		log.Warnf("model %d: resolving series failed, marking every building failed: %v", modelID, err)
		saveFailures(log, profileStore, modelID, allFailed(run.buildings, fmt.Sprintf("BuEM results could not be resolved: %v", err)))
		return nil
	}
	if err := combineParts(store, run.parts, run.resolved, &outcome); err != nil {
		return err
	}
	saveFailures(log, profileStore, modelID, outcome.failed)

	changed, err := configChanged(db, modelID, revision)
	if err != nil {
		return err
	}
	if changed {
		log.Infof("model %d changed while BuEM ran; the newer run links its results", modelID)
		return nil
	}
	if err := linkSeries(store, modelID, revision, run.resolved, outcome); err != nil {
		return err
	}
	for osmID, id := range outcome.profiles {
		result := buem.BuildingResult{ID: osmID, BUEM: json.RawMessage(outcome.stored[id].Summary)}
		saveResolvedProfile(log, profileStore, modelID, osmID, run.resolved[osmID], result)
	}
	return nil
}

// linkSeries links every series of each resolved building's profile to the
// model at revision, as user when the building carries customised parameters.
func linkSeries(store seriesStore, modelID uint, revision string, resolved map[string]BuemResolutionMeta, outcome seriesOutcome) error {
	var links []series.Link
	for osmID, id := range outcome.profiles {
		source := models.SeriesSourceDefault
		if resolved[osmID].Customised {
			source = models.SeriesSourceUser
		}
		for _, name := range outcome.stored[id].SeriesNames {
			links = append(links, series.Link{BuildingRef: osmID, Series: name, ProfileID: id, Source: source})
		}
	}
	return store.Link(series.Owner{ModelID: modelID}, revision, links)
}

// configChanged reports whether model's config no longer hashes to revision.
func configChanged(db *gorm.DB, modelID uint, revision string) (bool, error) {
	var current commonModels.Model
	if err := db.Select("id", "config").First(&current, modelID).Error; err != nil {
		return false, fmt.Errorf("re-read config of model %d: %w", modelID, err)
	}
	now, err := contenthash.Of(current.Config)
	if err != nil {
		return false, fmt.Errorf("hash config of model %d: %w", modelID, err)
	}
	return now != revision, nil
}

// allFailed fails every building of buildings with reason, recorded under its
// OSM way: one of several 3D buildings of a way fails the way.
func allFailed(buildings []buem.Building, reason string) map[string]string {
	failed := make(map[string]string, len(buildings))
	for _, b := range buildings {
		way, _, _ := strings.Cut(b.ID, partSeparator)
		failed[way] = reason
	}
	return failed
}

func saveFailures(log *logrus.Entry, profileStore demandProfileStore, modelID uint, failed map[string]string) {
	for osmID, reason := range failed {
		if err := profileStore.SaveFailed(modelID, osmID, reason); err != nil {
			log.Errorf("model %d osm_id=%s: failed to record failure: %v", modelID, osmID, err)
		}
	}
}

// saveResolvedProfile records one building's outcome: a BuEM rejection (no
// result, or a result carrying Error) is saved as failed with BuEM's reason;
// otherwise the annual energy summary is extracted and saved as resolved.
func saveResolvedProfile(log *logrus.Entry, profileStore demandProfileStore, modelID uint, osmID string, meta BuemResolutionMeta, result buem.BuildingResult) {
	if result.ID == "" || result.Error != "" || len(result.BUEM) == 0 {
		reason := "BuEM rejected this building"
		if result.Error != "" {
			reason = result.Error
		}
		if err := profileStore.SaveFailed(modelID, osmID, reason); err != nil {
			log.Errorf("model %d osm_id=%s: failed to record BuEM rejection: %v", modelID, osmID, err)
		}
		return
	}

	summary, err := extractEnergySummary(result.BUEM)
	if err != nil {
		log.Warnf("model %d osm_id=%s: failed to parse buem summary: %v", modelID, osmID, err)
		if err := profileStore.SaveFailed(modelID, osmID, "could not parse buem-gateway result"); err != nil {
			log.Errorf("model %d osm_id=%s: failed to record parse failure: %v", modelID, osmID, err)
		}
		return
	}

	if err := profileStore.SaveResolved(modelID, osmID, demandprofile.ResolvedProfile{
		TabulaVariantCode:  meta.VariantCode,
		RefurbishmentLevel: string(meta.Level),
		BuildingType:       meta.BuildingType,
		HeatingKwhA:        summary.Heating,
		CoolingKwhA:        summary.Cooling,
		ElectricityKwhA:    summary.Electricity,
		HotWaterKwhA:       summary.HotWater,
		KitchenKwhA:        summary.Kitchen,
		Profile:            result.BUEM,
	}); err != nil {
		log.Errorf("model %d osm_id=%s: failed to save resolved profile: %v", modelID, osmID, err)
	}
}

// energySummary is the annual totals of one BuEM result. Kitchen is in
// kWh_gas (a gas fuel channel), the others in kWh - see
// models.BuildingDemandProfile.
type energySummary struct {
	Heating, Cooling, Electricity, HotWater, Kitchen *float64
}

// extractEnergySummary pulls the annual per-vector totals out of a
// buem-gateway result's buem block (.thermal_load_profile.summary.*.total.
// value). hot_water and kitchen exist from buem-gateway 6.1.0 on; against
// an older gateway they decode as absent and are returned nil rather than
// 0, so a missing field is not recorded as a zero-demand building.
func extractEnergySummary(buemJSON json.RawMessage) (energySummary, error) {
	var body struct {
		ThermalLoadProfile struct {
			Summary struct {
				Heating     *energyTotal `json:"heating"`
				Cooling     *energyTotal `json:"cooling"`
				Electricity *energyTotal `json:"electricity"`
				HotWater    *energyTotal `json:"hot_water"`
				Kitchen     *energyTotal `json:"kitchen"`
			} `json:"summary"`
		} `json:"thermal_load_profile"`
	}
	if err := json.Unmarshal(buemJSON, &body); err != nil {
		return energySummary{}, fmt.Errorf("unmarshal buem summary: %w", err)
	}
	s := body.ThermalLoadProfile.Summary
	return energySummary{
		Heating:     s.Heating.value(),
		Cooling:     s.Cooling.value(),
		Electricity: s.Electricity.value(),
		HotWater:    s.HotWater.value(),
		Kitchen:     s.Kitchen.value(),
	}, nil
}

type energyTotal struct {
	Total struct {
		Value float64 `json:"value"`
	} `json:"total"`
}

// value returns the total as a pointer, nil when the vector was absent from
// the summary.
func (t *energyTotal) value() *float64 {
	if t == nil {
		return nil
	}
	v := t.Total.Value
	return &v
}

// buildCalculationPayload builds model's calculation payload and asserts its
// concrete type - BuildCalculationPayload always returns a payload.CalculationPayload
// wrapped as interface{}; the assertion only fails if that ever stops holding.
// DemandBuildings returns the osm ids of the buildings a demand resolve of the
// model covers, and the refurbishment level it records for them.
func DemandBuildings(model *commonModels.Model) ([]string, string, error) {
	calcPayload, err := buildCalculationPayload(model)
	if err != nil {
		return nil, "", err
	}
	return buildingOSMIDs(calcPayload.Topology), string(modelRefurbishmentLevel(model.Config)), nil
}

func buildCalculationPayload(model *commonModels.Model) (payload.CalculationPayload, error) {
	iface, err := payload.BuildCalculationPayload(model)
	if err != nil {
		return payload.CalculationPayload{}, err
	}
	calcPayload, ok := iface.(payload.CalculationPayload)
	if !ok {
		return payload.CalculationPayload{}, fmt.Errorf("unexpected calculation payload type %T", iface)
	}
	return calcPayload, nil
}

// modelWeatherProvider reads the model's weather archive from
// config.weatherProvider, the one series every simulation of the model uses,
// falling back to fallback for an absent, unknown, or unparseable value.
func modelWeatherProvider(config []byte, fallback string) string {
	var configMap map[string]interface{}
	if len(config) == 0 || json.Unmarshal(config, &configMap) != nil {
		return fallback
	}
	if provider, _ := configMap["weatherProvider"].(string); weather.IsProvider(provider) {
		return provider
	}
	return fallback
}

// modelWeatherPeriod reads the model's weather from config: weatherYear, a real
// archive year for validation runs, when set; otherwise weatherScenario; otherwise
// the typical scenario. An unknown scenario also falls back to the typical one.
func modelWeatherPeriod(config []byte) weather.Period {
	var configMap map[string]interface{}
	if len(config) == 0 || json.Unmarshal(config, &configMap) != nil {
		return weather.DefaultPeriod
	}
	if year, ok := configMap["weatherYear"].(float64); ok && year > 0 && year == math.Trunc(year) {
		return weather.Period{Year: int(year)}
	}
	if scenario, _ := configMap["weatherScenario"].(string); weather.IsScenario(scenario) {
		return weather.Period{Scenario: scenario}
	}
	return weather.DefaultPeriod
}

// modelRefurbishmentLevel reads the model-level refurbishment default from
// config.refurbishmentLevel (same top-level config map as energyVectors in
// internal/payload/payload.go), defaulting to existing state for an absent,
// invalid, or unparseable value.
func modelRefurbishmentLevel(config []byte) ignis.RefurbishmentLevel {
	var configMap map[string]interface{}
	if len(config) == 0 || json.Unmarshal(config, &configMap) != nil {
		return ignis.RefurbishmentExisting
	}
	level, _ := configMap["refurbishmentLevel"].(string)
	switch ignis.RefurbishmentLevel(level) {
	case ignis.RefurbishmentMedium, ignis.RefurbishmentAdvanced:
		return ignis.RefurbishmentLevel(level)
	default:
		return ignis.RefurbishmentExisting
	}
}
