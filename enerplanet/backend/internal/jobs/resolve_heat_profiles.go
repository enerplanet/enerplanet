package jobs

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/hibiken/asynq"
	"github.com/sirupsen/logrus"
	"gorm.io/gorm"

	commonModels "platform.local/common/pkg/models"
	"platform.local/platform/logger"
	"spatialhub_backend/internal/buem"
	"spatialhub_backend/internal/city2tabula"
	"spatialhub_backend/internal/ignis"
	"spatialhub_backend/internal/payload"
	"spatialhub_backend/internal/store/heatprofile"
	"spatialhub_backend/internal/weather"
)

// TypeResolveHeatProfiles is the auto-resolve job's asynq task type. Enqueued
// by UpdateModel/CreateModel whenever a saved config carries a building list
// (see internal/model/handler/model.go), independent of StartCalculation.
const TypeResolveHeatProfiles = "resolve_heat_profiles"

// ResolveHeatProfilesPayload is the resolve_heat_profiles job payload: just a
// model id. Unlike run_buem, this job rebuilds the calculation payload itself
// from the model's current, persisted Config rather than carrying a
// snapshot, since it can fire many times across a model's life.
type ResolveHeatProfilesPayload struct {
	ModelID uint `json:"model_id"`
}

// heatProfileStore is the persistence surface HandleResolveHeatProfiles
// needs. Satisfied by *heatprofile.Store; faked in tests.
type heatProfileStore interface {
	ResetForRun(modelID uint, osmIDs []string, refurbishmentLevel string) error
	SaveResolved(modelID uint, osmID string, p heatprofile.ResolvedProfile) error
	SaveFailed(modelID uint, osmID, reason string) error
}

// HandleResolveHeatProfiles resolves and persists every building's BuEM
// annual energy profile for a model, independent of StartCalculation/
// run_buem, so a building's profile is ready before the user ever opens its
// dialog. Reuses ResolveBuemForModel, the same envelope/weather/BuEM
// resolution HandleRunBuem uses for a full calculation run.
//
// A resolution problem (buem-gateway unreachable, no buildings in the
// topology) is recorded on the affected rows and never fails the job itself
// - there is no model status for this job to leave stuck, unlike run_buem.
func HandleResolveHeatProfiles(
	ctx context.Context,
	t *asynq.Task,
	db *gorm.DB,
	c2t *city2tabula.Client,
	wx *weather.Client,
	weatherProvider string,
	ignisClient *ignis.Client,
	buemClient *buem.Client,
	profileStore heatProfileStore,
) (retErr error) {
	log := logger.ForComponent("job:resolve_heat_profiles")

	defer func() {
		if r := recover(); r != nil {
			log.Errorf("PANIC in HandleResolveHeatProfiles: %v", r)
			retErr = fmt.Errorf("panic in resolve_heat_profiles: %v", r)
		}
	}()

	var rp ResolveHeatProfilesPayload
	if err := json.Unmarshal(t.Payload(), &rp); err != nil {
		return fmt.Errorf("failed to unmarshal payload: %w", err)
	}

	var model commonModels.Model
	if err := db.First(&model, rp.ModelID).Error; err != nil {
		return fmt.Errorf("failed to fetch model %d: %w", rp.ModelID, err)
	}

	calcPayload, err := buildCalculationPayload(&model)
	if err != nil {
		log.Debugf("model %d: cannot build calculation payload, nothing to resolve: %v", rp.ModelID, err)
		return nil
	}

	osmIDs := buildingOSMIDs(calcPayload.Topology)
	if len(osmIDs) == 0 {
		log.Debugf("model %d: no buildings in topology, nothing to resolve", rp.ModelID)
		return nil
	}

	refurbLevel := modelRefurbishmentLevel(model.Config)
	if err := profileStore.ResetForRun(rp.ModelID, osmIDs, string(refurbLevel)); err != nil {
		return fmt.Errorf("failed to reset heat profile rows for model %d: %w", rp.ModelID, err)
	}

	results, resolved, unresolved, err := ResolveBuemForModel(ctx, log, c2t, wx, weatherProvider, ignisClient, buemClient, model, calcPayload, refurbLevel)
	if err != nil {
		log.Warnf("model %d: buem-gateway call failed, marking every building failed: %v", rp.ModelID, err)
		for _, osmID := range osmIDs {
			if serr := profileStore.SaveFailed(rp.ModelID, osmID, "buem-gateway unavailable"); serr != nil {
				log.Errorf("model %d osm_id=%s: failed to record failure: %v", rp.ModelID, osmID, serr)
			}
		}
		return nil
	}

	for osmID, reason := range unresolved {
		if serr := profileStore.SaveFailed(rp.ModelID, osmID, reason); serr != nil {
			log.Errorf("model %d osm_id=%s: failed to record unresolved building: %v", rp.ModelID, osmID, serr)
		}
	}

	byID := make(map[string]buem.BuildingResult, len(results))
	for _, r := range results {
		byID[r.ID] = r
	}
	for osmID, meta := range resolved {
		saveResolvedProfile(log, profileStore, rp.ModelID, osmID, meta, byID[osmID])
	}

	return nil
}

// saveResolvedProfile records one building's outcome: a BuEM rejection (no
// result, or a result carrying Error) is saved as failed with BuEM's reason;
// otherwise the annual energy summary is extracted and saved as resolved.
func saveResolvedProfile(log *logrus.Entry, profileStore heatProfileStore, modelID uint, osmID string, meta BuemResolutionMeta, result buem.BuildingResult) {
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

	if err := profileStore.SaveResolved(modelID, osmID, heatprofile.ResolvedProfile{
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
// models.BuildingHeatProfile.
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
