package jobs

import "spatialhub_backend/internal/heatdemand"

// serviceBuildingTypes maps a normalised OSM f_class (as
// payload.createBuildingFeature emits it) to the BuEM service building_type
// it should be modelled as. BuEM's occupancy model has profiles for exactly
// these eight service ids; a class not listed here is not a service building.
var serviceBuildingTypes = map[string]string{
	"bakery":       "bakery",
	"supermarket":  "supermarket",
	"shop":         "supermarket",
	"retail":       "supermarket",
	"commercial":   "supermarket",
	"office":       "office",
	"school":       "school",
	"kindergarten": "school",
	"university":   "school",
	"hotel":        "hotel",
	"clinic":       "clinic",
	"hospital":     "clinic",
	"restaurant":   "restaurant",
	"cafe":         "restaurant",
	"warehouse":    "warehouse",
	"industrial":   "warehouse",
	"workshop":     "warehouse",
}

// serviceBuildingType returns the BuEM service id for fClass, or "" when the
// class is not one of the mapped service classes.
func serviceBuildingType(fClass string) string {
	return serviceBuildingTypes[heatdemand.Normalize(fClass)]
}

// buildingCapacity reads properties.capacity, the occupant count of a
// service building (set through the building form). nil when unset or not a
// positive whole number, in which case BuEM derives the capacity from floor
// area. There is no model-level default: an occupant count is inherently
// per building.
func buildingCapacity(props map[string]interface{}) *int {
	var n int
	switch v := props["capacity"].(type) {
	case float64:
		if v != float64(int(v)) {
			return nil
		}
		n = int(v)
	case int:
		n = v
	default:
		return nil
	}
	if n <= 0 {
		return nil
	}
	return &n
}
