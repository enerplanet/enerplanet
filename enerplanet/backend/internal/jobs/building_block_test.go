package jobs

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"spatialhub_backend/internal/city2tabula"
)

func TestVariantTypeAndPeriod(t *testing.T) {
	bt, p := variantTypeAndPeriod("NL.N.SFH.05.Gen.ReEx.001.001")
	assert.Equal(t, "SFH", bt)
	assert.Equal(t, "05", p)

	bt, p = variantTypeAndPeriod("DE.N.AB.03.Gen")
	assert.Equal(t, "AB", bt)
	assert.Equal(t, "03", p)

	bt, p = variantTypeAndPeriod("DE.DistrictMZLerch.F.DHH.SD.ReEx.001.001")
	assert.Equal(t, "", bt, "a non-TABULA type segment is not forwarded")
	assert.Equal(t, "", p, "a non-numeric period segment is not forwarded")

	bt, p = variantTypeAndPeriod("NL.N.SFH")
	assert.Equal(t, "", bt)
	assert.Equal(t, "", p)
}

func TestBuildingScalars(t *testing.T) {
	storeys := int32(3)
	footprint := 80.0
	room := 2.7
	code := "NL.N.TH.04.Gen.ReEx.001.001"

	got := buildingScalars(city2tabula.Building{
		NumberOfStoreys: &storeys, FootprintAreaSqm: &footprint, RoomHeight: &room, TabulaVariantCode: &code,
	})

	assert.Equal(t, 3, got["n_storeys"])
	assert.NotContains(t, got, "A_ref", "A_ref is left to BuEM to derive from the floor elements")
	assert.Equal(t, map[string]interface{}{"value": 2.7, "unit": "m"}, got["h_room"])
	assert.Equal(t, "TH", got["building_type"])
	assert.Equal(t, "04", got["construction_period"])
}

func TestBuildingScalars_omitsWhatCity2TabulaLacks(t *testing.T) {
	footprint := 80.0
	zero := int32(0)

	got := buildingScalars(city2tabula.Building{FootprintAreaSqm: &footprint, NumberOfStoreys: &zero})

	assert.Empty(t, got, "zero storeys is not a value, never a fake n_storeys")

	got = buildingScalars(city2tabula.Building{})
	assert.Empty(t, got)
}
