package jobs

import (
	"encoding/json"
	"testing"

	"github.com/sirupsen/logrus"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"spatialhub_backend/internal/buem"
	"spatialhub_backend/internal/ignis"
	"spatialhub_backend/internal/store/demandprofile"
)

// savedProfile is what fakeProfileStore recorded for one osm_id, flattened
// for easy assertions.
type savedProfile struct {
	Status       string
	VariantCode  string
	Level        string
	Heating      *float64
	BuildingType string
	HotWater     *float64
	Kitchen      *float64
	Reason       string
}

// fakeProfileStore is a hand-rolled demandProfileStore so
// HandleResolveDemandProfiles/saveResolvedProfile can be tested without a
// database.
type fakeProfileStore struct {
	saved map[string]savedProfile
}

func newFakeProfileStore() *fakeProfileStore {
	return &fakeProfileStore{saved: map[string]savedProfile{}}
}

func (f *fakeProfileStore) ResetForRun(modelID uint, osmIDs []string, refurbishmentLevel string) error {
	return nil
}

func (f *fakeProfileStore) SaveResolved(modelID uint, osmID string, p demandprofile.ResolvedProfile) error {
	f.saved[osmID] = savedProfile{
		Status:       "resolved",
		VariantCode:  p.TabulaVariantCode,
		Level:        p.RefurbishmentLevel,
		Heating:      p.HeatingKwhA,
		BuildingType: p.BuildingType,
		HotWater:     p.HotWaterKwhA,
		Kitchen:      p.KitchenKwhA,
	}
	return nil
}

func (f *fakeProfileStore) SaveFailed(modelID uint, osmID, reason string) error {
	f.saved[osmID] = savedProfile{Status: "failed", Reason: reason}
	return nil
}

func TestExtractEnergySummary(t *testing.T) {
	buemJSON := json.RawMessage(`{
		"thermal_load_profile": {
			"summary": {
				"heating":     {"total": {"value": 4823.5, "unit": "kWh"}},
				"cooling":     {"total": {"value": 312.4,  "unit": "kWh"}},
				"electricity": {"total": {"value": 2105.0, "unit": "kWh"}}
			}
		}
	}`)

	s, err := extractEnergySummary(buemJSON)

	require.NoError(t, err)
	require.NotNil(t, s.Heating)
	require.NotNil(t, s.Cooling)
	require.NotNil(t, s.Electricity)
	assert.Equal(t, 4823.5, *s.Heating)
	assert.Equal(t, 312.4, *s.Cooling)
	assert.Equal(t, 2105.0, *s.Electricity)
	// pre-6.1.0 gateway shape: the two newer vectors are absent, not zero
	assert.Nil(t, s.HotWater)
	assert.Nil(t, s.Kitchen)
}

func TestExtractEnergySummary_hotWaterAndKitchen(t *testing.T) {
	buemJSON := json.RawMessage(`{"thermal_load_profile":{"summary":{
		"heating":   {"total": {"value": 4823.5, "unit": "kWh"}},
		"hot_water": {"total": {"value": 33.3,   "unit": "kWh"}},
		"kitchen":   {"total": {"value": 7.76,   "unit": "kWh_gas"}}
	}}}`)

	s, err := extractEnergySummary(buemJSON)

	require.NoError(t, err)
	require.NotNil(t, s.HotWater)
	require.NotNil(t, s.Kitchen)
	assert.Equal(t, 33.3, *s.HotWater)
	assert.Equal(t, 7.76, *s.Kitchen)
	assert.Nil(t, s.Cooling, "an absent vector stays nil")
}

func TestExtractEnergySummary_malformedJSON(t *testing.T) {
	_, err := extractEnergySummary(json.RawMessage(`not json`))
	assert.Error(t, err)
}

func TestModelRefurbishmentLevel(t *testing.T) {
	assert.Equal(t, ignis.RefurbishmentExisting, modelRefurbishmentLevel(nil), "no config")
	assert.Equal(t, ignis.RefurbishmentExisting, modelRefurbishmentLevel([]byte(`null`)), "null config")
	assert.Equal(t, ignis.RefurbishmentExisting, modelRefurbishmentLevel([]byte(`{}`)), "no refurbishmentLevel key")
	assert.Equal(t, ignis.RefurbishmentExisting, modelRefurbishmentLevel([]byte(`{"refurbishmentLevel":"extreme"}`)), "unknown value falls back to existing")
	assert.Equal(t, ignis.RefurbishmentMedium, modelRefurbishmentLevel([]byte(`{"refurbishmentLevel":"medium"}`)))
	assert.Equal(t, ignis.RefurbishmentAdvanced, modelRefurbishmentLevel([]byte(`{"refurbishmentLevel":"advanced"}`)))
}

func TestSaveResolvedProfile_noResultIsSavedAsFailed(t *testing.T) {
	store := newFakeProfileStore()
	log := logrus.NewEntry(logrus.New())

	saveResolvedProfile(log, store, 1, "111", BuemResolutionMeta{}, buem.BuildingResult{})

	assert.Equal(t, "failed", store.saved["111"].Status)
}

func TestSaveResolvedProfile_buemErrorIsSavedAsFailedWithReason(t *testing.T) {
	store := newFakeProfileStore()
	log := logrus.NewEntry(logrus.New())

	saveResolvedProfile(log, store, 1, "111", BuemResolutionMeta{}, buem.BuildingResult{ID: "111", Error: "building.envelope is required"})

	assert.Equal(t, "failed", store.saved["111"].Status)
	assert.Equal(t, "building.envelope is required", store.saved["111"].Reason)
}

func TestSaveResolvedProfile_successIsSavedAsResolved(t *testing.T) {
	store := newFakeProfileStore()
	log := logrus.NewEntry(logrus.New())
	buemJSON := json.RawMessage(`{"thermal_load_profile":{"summary":{
		"heating":{"total":{"value":100}},"cooling":{"total":{"value":10}},"electricity":{"total":{"value":50}},
		"hot_water":{"total":{"value":33.3,"unit":"kWh"}},"kitchen":{"total":{"value":7.76,"unit":"kWh_gas"}}}}}`)

	saveResolvedProfile(log, store, 1, "111",
		BuemResolutionMeta{VariantCode: "DE.N.SFH.05.Gen.ReEx.001.001", Level: ignis.RefurbishmentMedium, BuildingType: "SFH"},
		buem.BuildingResult{ID: "111", BUEM: buemJSON})

	got := store.saved["111"]
	assert.Equal(t, "resolved", got.Status)
	assert.Equal(t, "SFH", got.BuildingType)
	assert.Equal(t, "DE.N.SFH.05.Gen.ReEx.001.001", got.VariantCode)
	assert.Equal(t, "medium", got.Level)
	require.NotNil(t, got.Heating)
	assert.Equal(t, 100.0, *got.Heating)
	require.NotNil(t, got.HotWater)
	assert.Equal(t, 33.3, *got.HotWater)
	require.NotNil(t, got.Kitchen)
	assert.Equal(t, 7.76, *got.Kitchen)
}
