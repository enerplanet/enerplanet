package jobs

import (
	"fmt"

	"spatialhub_backend/internal/city2tabula"
	"spatialhub_backend/internal/heatdemand"
)

// A building of unknown, agricultural or industrial use that is both lower and
// smaller than these counts as unheated. Measured on the v4 test data.
const (
	unheatedMaxHeightM     = 5.0
	unheatedMaxFootprintM2 = 50.0
)

// Where a building's type came from.
const (
	useSourceUser = "user"
	useSource3D   = "3d"
	useSourceOSM  = "osm"
)

// Why a building is not heated, stored as its demand profile's reason.
const (
	reasonAncillary = "ancillary building"
	reasonSmall     = "lower than 5 m and smaller than 50 m²"
	reasonNo3D      = "no 3D data, so its heat demand cannot be calculated"
)

// ancillaryClasses are OSM building values, and the 3D use, of structures
// that are not heated.
var ancillaryClasses = map[string]bool{
	"ancillary": true, "garage": true, "garages": true, "carport": true, "shed": true,
	"roof": true, "parking": true, "ruins": true, "collapsed": true, "bunker": true,
	"barn": true, "transformer_tower": true, "substation": true, "tech_cab": true,
}

// sizeRuleUses are 3D uses that cover both heated buildings and unheated
// sheds, so the size rule decides.
var sizeRuleUses = map[string]bool{"agriculture": true, "industry": true}

// buildingUse is a building way's type and whether it is heated. An empty
// useType means Other buildings; reason says why it is not heated.
type buildingUse struct {
	useType string
	source  string
	heated  bool
	reason  string
}

// resolveBuildingUse applies SC-15 to one way: the user's type, else the 3D
// use, else a specific OSM class, else Other buildings. buildings are its 3D
// buildings, largest first; lookupDone is false when the 3D lookup did not
// complete, so a missing 3D building does not count as having none.
//
// The largest 3D building decides for the whole way, so a terraced row that
// mixes houses and garages under one way is not split by part.
func resolveBuildingUse(props map[string]interface{}, buildings []city2tabula.Building, lookupDone bool) buildingUse {
	if _, stored := storedBuemBlock(props); stored {
		return buildingUse{heated: true}
	}
	var b *city2tabula.Building
	if len(buildings) > 0 {
		b = &buildings[0]
	}
	use := buildingType(props, b)
	switch {
	case b == nil && lookupDone:
		use.reason = reasonNo3D
	case b == nil:
		use.heated = true
	case ancillaryClasses[use.useType]:
		use.reason = reasonAncillary
	case (use.source == "" || use.source == useSource3D && sizeRuleUses[use.useType]) && isSmall(*b):
		use.reason = reasonSmall
	default:
		use.heated = true
	}
	return use
}

// buildingType returns the type and its source in the order user, 3D, OSM.
// The 3D use "other" says no more than OSM's "yes", so it does not count.
func buildingType(props map[string]interface{}, b *city2tabula.Building) buildingUse {
	if t := specificClass(props["selected_f_class"]); t != "" {
		return buildingUse{useType: t, source: useSourceUser}
	}
	if b != nil && b.UseType != nil && *b.UseType != "" && *b.UseType != "other" {
		return buildingUse{useType: *b.UseType, source: useSource3D}
	}
	if t := specificClass(props["f_class"]); t != "" {
		return buildingUse{useType: t, source: useSourceOSM}
	}
	return buildingUse{}
}

// specificClass normalises an OSM class, returning "" for one that names no use.
func specificClass(v interface{}) string {
	s, _ := v.(string)
	switch t := heatdemand.Normalize(s); t {
	case "yes", "unknown", "building":
		return ""
	default:
		return t
	}
}

// isSmall applies the size rule; a building missing either measurement is not small.
func isSmall(b city2tabula.Building) bool {
	return b.MaxHeight != nil && b.FootprintAreaSqm != nil &&
		*b.MaxHeight < unheatedMaxHeightM && *b.FootprintAreaSqm < unheatedMaxFootprintM2
}

// buildingUses resolves the use of every building way of topology except
// the further ways, whose building is resolved under another way.
func buildingUses(topology []interface{}, envelopes map[string][]city2tabula.Building, further map[string]string, lookupDone bool) map[string]buildingUse {
	uses := map[string]buildingUse{}
	for _, entry := range topology {
		e, _ := entry.(map[string]interface{})
		for _, key := range []string{"from", "to"} {
			props, osmID, ok := buildingProperties(e[key])
			if _, isFurther := further[osmID]; !ok || isFurther {
				continue
			}
			uses[osmID] = resolveBuildingUse(props, envelopes[osmID], lookupDone)
		}
	}
	return uses
}

// dropUnheatedHeat removes the heat technologies and heat demand of the
// payload buildings in notHeated, which resolveBuildingUse gave no heat
// demand, and returns how many buildings lost a heat technology.
func dropUnheatedHeat(topology []interface{}, notHeated map[string]bool) int {
	dropped := 0
	for _, feature := range payloadBuildings(topology) {
		props, _ := feature["properties"].(map[string]interface{})
		if !notHeated[fmt.Sprint(props["osm_id"])] {
			continue
		}
		dropCarrier(props, "demand_heat", "f_class_heat_demands", "demand_heat_energy")
		techs, _ := feature["techs"].(map[string]interface{})
		if hasAnyTech(techs, heatTechs) {
			dropped++
		}
		for _, key := range heatTechs {
			delete(techs, key)
		}
	}
	return dropped
}
