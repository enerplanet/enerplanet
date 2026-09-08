package jobs

import (
	"regexp"
	"strings"

	"spatialhub_backend/internal/city2tabula"
)

// tabulaBuildingTypes are the building_type codes BuEM's request contract
// documents (single-family, terraced, multi-family, apartment block).
var tabulaBuildingTypes = map[string]bool{"SFH": true, "TH": true, "MFH": true, "AB": true}

var tabulaPeriodCode = regexp.MustCompile(`^[0-9]{2}$`)

// variantTypeAndPeriod extracts building_type and construction_period from a
// TABULA variant code, e.g. "NL.N.SFH.05.Gen.ReEx.001.001" -> "SFH", "05"
// (third and fourth dot-separated segments). Either value is "" when the
// segment is missing or not one of the documented codes, so a caller can
// omit the field rather than send something BuEM would not recognise.
func variantTypeAndPeriod(code string) (buildingType, period string) {
	parts := strings.Split(code, ".")
	if len(parts) < 4 {
		return "", ""
	}
	if tabulaBuildingTypes[parts[2]] {
		buildingType = parts[2]
	}
	if tabulaPeriodCode.MatchString(parts[3]) {
		period = parts[3]
	}
	return buildingType, period
}

// buildingScalars returns the per-building scalar inputs BuEM's building
// block takes, from what City2TABULA resolved for the building: n_storeys
// and h_room (geometry, used for heating/cooling and window synthesis), and
// building_type and construction_period from the TABULA variant code
// (building_type selects BuEM's residential occupancy model; a value outside
// SFH/TH/MFH/AB would route the building through BuEM's service-building
// branch, so anything else is omitted). A field is left out whenever
// City2TABULA has no value for it, so BuEM applies its own default instead
// of receiving a made-up number.
//
// A_ref is deliberately not sent: BuEM derives it from the floor elements
// and its residential occupancy model does not read it.
func buildingScalars(b city2tabula.Building) map[string]interface{} {
	out := map[string]interface{}{}
	if b.NumberOfStoreys != nil && *b.NumberOfStoreys >= 1 {
		out["n_storeys"] = int(*b.NumberOfStoreys)
	}
	if b.RoomHeight != nil && *b.RoomHeight > 0 {
		out["h_room"] = map[string]interface{}{"value": *b.RoomHeight, "unit": "m"}
	}
	if b.TabulaVariantCode != nil {
		if t, p := variantTypeAndPeriod(*b.TabulaVariantCode); t != "" {
			out["building_type"] = t
			if p != "" {
				out["construction_period"] = p
			}
		}
	}
	return out
}
