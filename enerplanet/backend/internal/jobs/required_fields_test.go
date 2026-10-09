package jobs

import (
	"context"
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"spatialhub_backend/internal/city2tabula"
	"spatialhub_backend/internal/ignis"
)

// requiredFieldsBlock runs one building through buildingsForBuem and returns
// its building block, or the reason it was left out.
func requiredFieldsBlock(t *testing.T, country, fClass string, b city2tabula.Building) (map[string]interface{}, string) {
	t.Helper()
	b.OSMID = "1"
	if b.Surfaces == nil {
		b.Surfaces = []city2tabula.Surface{{ID: "w1", Type: "WallSurface", AreaSqm: floatPtr(20), Azimuth: floatPtr(90), Tilt: floatPtr(0)}}
	}
	node := map[string]interface{}{"from": map[string]interface{}{
		"geometry":   map[string]interface{}{"type": "Point", "coordinates": []interface{}{6.0, 52.0}},
		"properties": map[string]interface{}{"feature_type": "BasePOI", "osm_id": "1", "f_class": fClass},
	}}
	client := fakeEnvelopeUValueResolver{uValues: ignis.EnvelopeUValues{UWall: 1, URoof: 1, UFloor: 1}}
	buildings, _, unresolved := buildingsForBuem(context.Background(), client, country,
		[]interface{}{node}, map[string]city2tabula.Building{"1": b}, ignis.RefurbishmentExisting,
		cookingSettings{Carrier: CookingElectric, IncludeDHW: true})
	if len(buildings) == 0 {
		return nil, unresolved["1"]
	}
	var block map[string]interface{}
	require.NoError(t, json.Unmarshal(buildings[0].Building, &block))
	return block, ""
}

func TestBuildingsForBuem_sendsCountryAndFloorAreaAsRequired(t *testing.T) {
	code := "NL.N.SFH.03.Gen.ReEx.001.001"
	block, reason := requiredFieldsBlock(t, "netherlands", "detached",
		city2tabula.Building{TabulaVariantCode: &code, FloorAreaSqm: floatPtr(145.1)})

	require.Empty(t, reason)
	assert.Equal(t, "NL", block["country"])
	assert.Equal(t, map[string]interface{}{"value": 145.1, "unit": "m2"}, block["A_ref"],
		"A_ref is the whole building's conditioned floor area, not BuEM's 100 m2 fallback")
	assert.Equal(t, "SFH", block["building_type"])
	assert.NotContains(t, block, "residential_units", "only MFH and AB carry a dwelling count")
}

func TestBuildingsForBuem_unmatchedBuildingIsSentAsOneDwellingMFH(t *testing.T) {
	block, reason := requiredFieldsBlock(t, "czechia", "yes", city2tabula.Building{FloorAreaSqm: floatPtr(300)})

	require.Empty(t, reason)
	assert.Equal(t, "CZ", block["country"])
	assert.Equal(t, "MFH", block["building_type"])
	assert.EqualValues(t, 1, block["residential_units"])
}

func TestBuildingsForBuem_buildingWithoutFloorAreaIsLeftOut(t *testing.T) {
	_, reason := requiredFieldsBlock(t, "germany", "detached", city2tabula.Building{})

	assert.Contains(t, reason, "floor area")
}

func TestBuildingsForBuem_countryWithoutISOCodeIsLeftOut(t *testing.T) {
	_, reason := requiredFieldsBlock(t, "atlantis", "detached", city2tabula.Building{FloorAreaSqm: floatPtr(100)})

	assert.Contains(t, reason, "atlantis")
}
