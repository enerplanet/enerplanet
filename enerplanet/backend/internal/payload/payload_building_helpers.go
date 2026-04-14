package payload

import (
	"encoding/json"
	"fmt"
	"math"
	"strings"

	"platform.local/platform/logger"
)

func getFeatures(configMap map[string]interface{}, key string) []interface{} {
	if fc, ok := configMap[key].(map[string]interface{}); ok {
		if features, ok := fc["features"].([]interface{}); ok {
			return features
		}
	}
	return nil
}

var classAliases = map[string]string{
	"semi_detached":           "semidetached_house",
	"semi-detached":           "semidetached_house",
	"town_house":              "townhouse",
	"community_center":        "community_centre",
	"doctors_office":          "doctors",
	"doctor":                  "doctors",
	"gas_station":             "fuel",
	"allotment_house":         "house",
	"greenhouse_horticulture": "greenhouse",
}

var genericPrimaryFClasses = map[string]struct{}{
	"yes":                {},
	"building":           {},
	"residential":        {},
	"house":              {},
	"apartments":         {},
	"apartment":          {},
	"detached":           {},
	"semidetached_house": {},
	"terrace":            {},
	"townhouse":          {},
	"allotment_house":    {},
	"unclassified":       {},
	"other":              {},
}


var specificDemandByFClass = map[string]float64{
	"ab":                      28,
	"agricultural":            50,
	"apartment":               30,
	"apartments":              25,
	"arts_centre":             120,
	"association":             100,
	"bakehouse":               500,
	"bakery":                  500,
	"bank":                    190,
	"bar":                     300,
	"barn":                    30,
	"beverages":               140,
	"bicycle":                 100,
	"bicycle_parking":         5,
	"boat_house":              20,
	"boathouse":               20,
	"books":                   80,
	"brewery":                 320,
	"bridge":                  15,
	"building":                30,
	"bungalow":                35,
	"bunker":                  30,
	"butcher":                 200,
	"cabin":                   25,
	"cafe":                    300,
	"car":                     100,
	"car_repair":              140,
	"car_wash":                200,
	"carpenter":               120,
	"carport":                 15,
	"cathedral":               50,
	"chapel":                  30,
	"chemist":                 140,
	"chicken_coop":            50,
	"church":                  40,
	"cinema":                  200,
	"civic":                   170,
	"clinic":                  350,
	"clothes":                 100,
	"collapsed":               0,
	"college":                 180,
	"commercial":              245.7,
	"community_centre":        110,
	"company":                 120,
	"construction":            60,
	"container":               50,
	"convenience":             180,
	"courthouse":              155,
	"cowshed":                 50,
	"crematorium":             140,
	"dance":                   160,
	"data_center":             3500,
	"default":                 155.7,
	"dentist":                 180,
	"detached":                35,
	"digester":                120,
	"diplomatic":              140,
	"doctors":                 180,
	"doityourself":            100,
	"dormitory":               20,
	"educational_institution": 120,
	"electrician":             120,
	"electricity":             60,
	"electronics":             120,
	"embassy":                 180,
	"factory":                 280,
	"farm":                    80,
	"farm_auxiliary":          30,
	"farmhouse":               40,
	"fast_food":               600,
	"fire_station":            150,
	"fitness_centre":          200,
	"florist":                 120,
	"fuel":                    180,
	"furniture":               80,
	"gallery":                 100,
	"garage":                  25,
	"garages":                 25,
	"garden_centre":           80,
	"gardener":                80,
	"gatehouse":               50,
	"ger":                     15,
	"government":              180,
	"granary":                 30,
	"grandstand":              60,
	"greenhouse":              160,
	"guest_house":             170,
	"hairdresser":             160,
	"hangar":                  80,
	"hardware":                100,
	"hayloft":                 15,
	"healthcare":              350,
	"hospital":                450,
	"hostel":                  160,
	"hotel":                   250,
	"house":                   35,
	"houseboat":               20,
	"hut":                     15,
	"industrial":              200,
	"insurance":               120,
	"jewelry":                 120,
	"kindergarten":            130,
	"kiosk":                   200,
	"library":                 150,
	"livestock":               40,
	"logistics":               80,
	"mall":                    350,
	"manufacture":             240,
	"marketplace":             120,
	"metal_construction":      160,
	"mfh":                     30,
	"military":                180,
	"mixed_use":               200,
	"monastery":               90,
	"mosque":                  60,
	"motel":                   200,
	"museum":                  130,
	"nightclub":               250,
	"nursing_home":            200,
	"office":                  170,
	"oil_mill":                200,
	"optician":                140,
	"other":                   30,
	"outbuilding":             10,
	"painter":                 100,
	"parking":                 30,
	"pavilion":                80,
	"pet":                     120,
	"pharmacy":                220,
	"place_of_worship":        55,
	"plumber":                 120,
	"police":                  170,
	"post_office":             120,
	"power":                   80,
	"prison":                  200,
	"pub":                     300,
	"public":                  155.7,
	"public_bath":             250,
	"religious":               40,
	"research":                200,
	"residential":             25,
	"restaurant":              500,
	"retail":                  280,
	"retirement_home":         160,
	"riding_hall":             80,
	"roof":                    5,
	"ruins":                   0,
	"sauna":                   250,
	"sawmill":                 220,
	"school":                  120,
	"semidetached_house":      30,
	"service":                 120,
	"sewage_pumping_station":  55,
	"sfh":                     35,
	"shed":                    5,
	"shelter":                 20,
	"shoes":                   100,
	"shop":                    260,
	"shrine":                  20,
	"silo":                    30,
	"slurry_tank":             15,
	"social_facility":         130,
	"sports":                  100,
	"sports_centre":           170,
	"sports_hall":             130,
	"stable":                  40,
	"stadium":                 100,
	"static_caravan":          25,
	"station":                 160,
	"stonemason":              120,
	"storage_tank":            30,
	"store":                   260,
	"studio":                  140,
	"sty":                     50,
	"substation":              60,
	"summer_house":            20,
	"supermarket":             400,
	"swimming_pool":           350,
	"synagogue":               50,
	"tank":                    15,
	"tech_cab":                120,
	"temple":                  50,
	"terminal":                180,
	"terrace":                 30,
	"th":                      32,
	"theatre":                 170,
	"toilets":                 80,
	"toll_booth":              60,
	"townhall":                155,
	"townhouse":               32,
	"toys":                    100,
	"train_station":           200,
	"training":                150,
	"transformer_tower":       15,
	"transportation":          120,
	"travel_agency":           120,
	"tree_house":              10,
	"trullo":                  25,
	"unclassified":            30,
	"university":              200,
	"utility":                 60,
	"veterinary":              160,
	"warehouse":               80,
	"water_tower":             50,
	"watermill":               80,
	"wholesale":               80,
	"windmill":                60,
	"winery":                  160,
	"works":                   220,
	"workshop":                180,
	"yes":                     30,
}

func normalizeFClass(raw string) string {
	v := strings.ToLower(strings.TrimSpace(raw))
	if v == "" {
		return ""
	}
	v = strings.ReplaceAll(v, "-", "_")
	v = strings.ReplaceAll(v, " ", "_")
	for strings.Contains(v, "__") {
		v = strings.ReplaceAll(v, "__", "_")
	}
	v = strings.Trim(v, "_")
	if alias, ok := classAliases[v]; ok {
		return alias
	}
	return v
}

func splitFClassString(raw string) []string {
	v := strings.TrimSpace(raw)
	if v == "" {
		return nil
	}

	// Support serialized JSON arrays (e.g. ["restaurant","doctors"])
	if strings.HasPrefix(v, "[") && strings.HasSuffix(v, "]") {
		var parsed []string
		if err := json.Unmarshal([]byte(v), &parsed); err == nil {
			out := make([]string, 0, len(parsed))
			for _, item := range parsed {
				out = append(out, normalizeFClass(item))
			}
			return out
		}
	}

	separators := func(r rune) bool {
		return r == ',' || r == ';' || r == '|' || r == '/'
	}
	parts := strings.FieldsFunc(v, separators)
	if len(parts) == 0 {
		parts = []string{v}
	}

	out := make([]string, 0, len(parts))
	for _, p := range parts {
		p = strings.Trim(p, "\"'[] ")
		if p == "" {
			continue
		}
		out = append(out, normalizeFClass(p))
	}
	return out
}

func extractFClassValues(value interface{}) []string {
	switch v := value.(type) {
	case []string:
		out := make([]string, 0, len(v))
		for _, item := range v {
			out = append(out, splitFClassString(item)...)
		}
		return out
	case []interface{}:
		out := make([]string, 0, len(v))
		for _, item := range v {
			out = append(out, splitFClassString(getStringValue(item))...)
		}
		return out
	case string:
		return splitFClassString(v)
	default:
		return nil
	}
}

func extractBuildingFClasses(props map[string]interface{}) []string {
	if props == nil {
		return []string{"residential"}
	}

	extractByKeys := func(keys []string) []string {
		rawValues := make([]string, 0, len(keys))
		for _, key := range keys {
			rawValues = append(rawValues, extractFClassValues(props[key])...)
		}
		return rawValues
	}

	normalizeAndDedupe := func(rawValues []string) []string {
		seen := make(map[string]struct{}, len(rawValues))
		out := make([]string, 0, len(rawValues))
		for _, value := range rawValues {
			norm := normalizeFClass(value)
			if norm == "" || norm == "yes" || norm == "building" || norm == "unknown" {
				continue
			}
			if _, ok := seen[norm]; ok {
				continue
			}
			seen[norm] = struct{}{}
			out = append(out, norm)
		}
		return out
	}

	// Canonical fields win. Legacy fields are only used as fallback.
	canonical := normalizeAndDedupe(extractByKeys([]string{"f_classes", "f_class", "fclass"}))
	if len(canonical) > 0 {
		return canonical
	}

	out := normalizeAndDedupe(extractByKeys([]string{"type", "use", "building_type", "building_t"}))
	if len(out) == 0 {
		return []string{"residential"}
	}
	return out
}

func selectPrimaryBuildingFClass(classes []string) string {
	if len(classes) == 0 {
		return "residential"
	}

	best := classes[0]
	bestScore := 0
	if _, generic := genericPrimaryFClasses[best]; generic {
		bestScore = 0
	} else {
		bestScore = 1
	}

	for _, cls := range classes[1:] {
		score := 1
		if _, generic := genericPrimaryFClasses[cls]; generic {
			score = 0
		}
		if score > bestScore {
			best = cls
			bestScore = score
		}
	}

	return best
}

func inferCategoryFromFClass(fClass string) string {
	fc := normalizeFClass(fClass)
	switch {
	case strings.Contains(fc, "house"), strings.Contains(fc, "apartment"), strings.Contains(fc, "residential"), strings.Contains(fc, "dormitory"), strings.Contains(fc, "villa"), strings.Contains(fc, "terrace"), strings.Contains(fc, "townhouse"):
		return "residential"
	case strings.Contains(fc, "school"), strings.Contains(fc, "hospital"), strings.Contains(fc, "university"), strings.Contains(fc, "church"), strings.Contains(fc, "government"), strings.Contains(fc, "community"), strings.Contains(fc, "library"), strings.Contains(fc, "museum"), strings.Contains(fc, "theatre"):
		return "public"
	case strings.Contains(fc, "factory"), strings.Contains(fc, "industrial"), strings.Contains(fc, "warehouse"), strings.Contains(fc, "workshop"), strings.Contains(fc, "manufacture"), strings.Contains(fc, "sewage"), strings.Contains(fc, "airport"), strings.Contains(fc, "station"), strings.Contains(fc, "substation"), strings.Contains(fc, "power"):
		return "industrial"
	case strings.Contains(fc, "farm"), strings.Contains(fc, "barn"), strings.Contains(fc, "greenhouse"), strings.Contains(fc, "agricultural"), strings.Contains(fc, "stable"):
		return "agricultural"
	default:
		return "commercial"
	}
}

func demandProfileForFClass(fClass string) string {
	norm := normalizeFClass(fClass)
	if norm != "" {
		return norm
	}
	return "residential"
}

func normalizeUniqueFClasses(fClasses []string) []string {
	if len(fClasses) == 0 {
		return []string{"residential"}
	}

	seen := make(map[string]struct{}, len(fClasses))
	out := make([]string, 0, len(fClasses))
	for _, cls := range fClasses {
		norm := normalizeFClass(cls)
		if norm == "" {
			continue
		}
		if _, ok := seen[norm]; ok {
			continue
		}
		seen[norm] = struct{}{}
		out = append(out, norm)
	}

	if len(out) == 0 {
		return []string{"residential"}
	}
	return out
}

func resolveSelectedBuildingFClass(props map[string]interface{}, availableClasses []string) string {
	if props == nil {
		return ""
	}
	available := normalizeUniqueFClasses(availableClasses)
	if len(available) == 0 {
		return ""
	}

	allowed := make(map[string]struct{}, len(available))
	for _, cls := range available {
		allowed[normalizeFClass(cls)] = struct{}{}
	}

	candidateKeys := []string{"selected_f_class", "selectedFClass", "active_f_class"}
	for _, key := range candidateKeys {
		for _, candidate := range extractFClassValues(props[key]) {
			selected := normalizeFClass(candidate)
			if selected == "" {
				continue
			}
			if _, ok := allowed[selected]; ok {
				return selected
			}
		}
	}
	return ""
}

func parseStoredFClassDemands(raw interface{}, fallbackClasses []string) ([]map[string]interface{}, int64) {
	if raw == nil {
		return nil, 0
	}

	parsed := raw
	if text, ok := raw.(string); ok {
		text = strings.TrimSpace(text)
		if text == "" {
			return nil, 0
		}
		var decoded []interface{}
		if err := json.Unmarshal([]byte(text), &decoded); err != nil {
			return nil, 0
		}
		parsed = decoded
	}

	var rows []interface{}
	switch v := parsed.(type) {
	case []interface{}:
		rows = v
	case []map[string]interface{}:
		rows = make([]interface{}, 0, len(v))
		for _, item := range v {
			rows = append(rows, item)
		}
	default:
		return nil, 0
	}

	out := make([]map[string]interface{}, 0, len(rows))
	var total int64
	for idx, row := range rows {
		record, ok := row.(map[string]interface{})
		if !ok {
			continue
		}

		cls := normalizeFClass(getStringValue(record["f_class"]))
		if cls == "" {
			cls = normalizeFClass(getStringValue(record["fClass"]))
		}
		if cls == "" {
			cls = normalizeFClass(getStringValue(record["class"]))
		}
		if cls == "" && idx < len(fallbackClasses) {
			cls = normalizeFClass(fallbackClasses[idx])
		}
		if cls == "" {
			continue
		}

		demand := getFloatValue(record["demand_energy"])
		if demand <= 0 {
			demand = getFloatValue(record["yearlyDemandKwh"])
		}
		if demand <= 0 {
			demand = getFloatValue(record["yearly_demand_kwh"])
		}
		if demand < 0 {
			demand = 0
		}

		profile := demandProfileForFClass(cls)

		demandInt := int64(math.Round(demand))
		total += demandInt
		out = append(out, map[string]interface{}{
			"demand_energy": demandInt,
			"profile":       profile,
		})
	}

	if len(out) == 0 {
		return nil, 0
	}
	return out, total
}

func filterDemandsBySelectedFClass(
	fClassDemands []map[string]interface{},
	selectedFClass string,
) ([]map[string]interface{}, int64) {
	selected := normalizeFClass(selectedFClass)
	if selected == "" || len(fClassDemands) == 0 {
		return nil, 0
	}

	filtered := make([]map[string]interface{}, 0, 1)
	var total int64
	for _, detail := range fClassDemands {
		cls := normalizeFClass(getStringValue(detail["f_class"]))
		if cls == "" || cls != selected {
			continue
		}
		demand := int64(math.Round(getFloatValue(detail["demand_energy"])))
		if demand < 0 {
			demand = 0
		}
		total += demand
		filtered = append(filtered, map[string]interface{}{
			"demand_energy": demand,
			"profile":       demandProfileForFClass(selected),
		})
	}

	if len(filtered) == 0 {
		return nil, 0
	}
	return filtered, total
}

func distributeDemandEvenly(classes []string, totalDemand int64) ([]map[string]interface{}, int64) {
	if len(classes) == 0 {
		return nil, 0
	}
	if totalDemand < 0 {
		totalDemand = 0
	}

	base := totalDemand / int64(len(classes))
	remainder := totalDemand % int64(len(classes))
	out := make([]map[string]interface{}, 0, len(classes))

	for idx, cls := range classes {
		demand := base
		if int64(idx) < remainder {
			demand++
		}
		out = append(out, map[string]interface{}{
			"demand_energy": demand,
			"profile":       demandProfileForFClass(cls),
		})
	}

	return out, totalDemand
}

func calculateYearlyDemandPerFClass(
	fClasses []string,
	areaSqm float64,
	storedDetails interface{},
	explicitDemand float64,
) ([]map[string]interface{}, int64) {
	classes := normalizeUniqueFClasses(fClasses)

	if stored, storedTotal := parseStoredFClassDemands(storedDetails, classes); len(stored) > 0 {
		if storedTotal == 0 && explicitDemand > 0 {
			targetTotal := int64(math.Round(explicitDemand))
			base := targetTotal / int64(len(stored))
			remainder := targetTotal % int64(len(stored))
			for idx, detail := range stored {
				demand := base
				if int64(idx) < remainder {
					demand++
				}
				detail["demand_energy"] = demand
			}
			return stored, targetTotal
		}
		return stored, storedTotal
	}

	if explicitDemand > 0 {
		return distributeDemandEvenly(classes, int64(math.Round(explicitDemand)))
	}

	if areaSqm <= 0 {
		return distributeDemandEvenly(classes, 0)
	}

	areaShare := areaSqm / float64(len(classes))
	out := make([]map[string]interface{}, 0, len(classes))
	var total int64

	for _, cls := range classes {
		demand := int64(math.Round(areaShare * specificDemandForFClass(cls)))
		if demand < 0 {
			demand = 0
		}
		total += demand
		out = append(out, map[string]interface{}{
			"demand_energy": demand,
			"profile":       demandProfileForFClass(cls),
		})
	}

	return out, total
}

// extractPointsFromRing extracts float64 coordinate pairs from a coordinate ring
func extractPointsFromRing(ring []interface{}) [][]float64 {
	var points [][]float64
	for _, p := range ring {
		pt, ok := p.([]interface{})
		if !ok || len(pt) < 2 {
			continue
		}
		points = append(points, []float64{getFloatValue(pt[0]), getFloatValue(pt[1])})
	}
	return points
}

// extractPolygonPoints extracts points from Polygon coordinates
func extractPolygonPoints(coords interface{}) [][]float64 {
	ring, ok := coords.([]interface{})
	if !ok || len(ring) == 0 {
		return nil
	}
	outer, ok := ring[0].([]interface{})
	if !ok {
		return nil
	}
	return extractPointsFromRing(outer)
}

// extractMultiPolygonPoints extracts points from MultiPolygon coordinates (first polygon only)
func extractMultiPolygonPoints(coords interface{}) [][]float64 {
	polys, ok := coords.([]interface{})
	if !ok || len(polys) == 0 {
		return nil
	}
	poly, ok := polys[0].([]interface{})
	if !ok || len(poly) == 0 {
		return nil
	}
	outer, ok := poly[0].([]interface{})
	if !ok {
		return nil
	}
	return extractPointsFromRing(outer)
}

// calculateCentroid calculates the centroid of a set of points
func calculateCentroid(points [][]float64) []float64 {
	if len(points) == 0 {
		return nil
	}
	var sumX, sumY float64
	for _, p := range points {
		sumX += p[0]
		sumY += p[1]
	}
	return []float64{sumX / float64(len(points)), sumY / float64(len(points))}
}

func convertToPointGeometry(geom map[string]interface{}) (map[string]interface{}, error) {
	log := logger.ForComponent("payload")

	if geom == nil {
		return nil, fmt.Errorf("geometry is nil")
	}

	geomType, ok := geom["type"].(string)
	if !ok || geomType == "" {
		return nil, fmt.Errorf("geometry missing or invalid type")
	}

	coords := geom["coordinates"]
	if coords == nil {
		return nil, fmt.Errorf("geometry missing coordinates")
	}

	if geomType == "Point" {
		return geom, nil
	}

	var points [][]float64
	switch geomType {
	case "Polygon":
		points = extractPolygonPoints(coords)
	case "MultiPolygon":
		points = extractMultiPolygonPoints(coords)
	default:
		log.Warnf("Unsupported geometry type: %s", geomType)
		return nil, fmt.Errorf("unsupported geometry type: %s", geomType)
	}

	centroid := calculateCentroid(points)
	if centroid == nil {
		return nil, fmt.Errorf("failed to calculate centroid for %s geometry", geomType)
	}

	return map[string]interface{}{
		"type":        "Point",
		"coordinates": centroid,
	}, nil
}

func calculateDistance(geom1, geom2 map[string]interface{}) float64 {
	log := logger.ForComponent("payload")

	pt1, err1 := convertToPointGeometry(geom1)
	pt2, err2 := convertToPointGeometry(geom2)

	if err1 != nil {
		log.Warnf("Failed to convert geometry 1 to point: %v", err1)
		return 0
	}
	if err2 != nil {
		log.Warnf("Failed to convert geometry 2 to point: %v", err2)
		return 0
	}

	coords1 := getCoordinates(pt1["coordinates"])
	coords2 := getCoordinates(pt2["coordinates"])

	if len(coords1) < 2 || len(coords2) < 2 {
		log.Warnf("Invalid coordinates: coords1=%v, coords2=%v", coords1, coords2)
		return 0
	}

	lat1, lon1 := coords1[1], coords1[0]
	lat2, lon2 := coords2[1], coords2[0]

	// Validate coordinate ranges
	if lat1 < -90 || lat1 > 90 || lat2 < -90 || lat2 > 90 {
		log.Warnf("Invalid latitude values: lat1=%.6f, lat2=%.6f", lat1, lat2)
		return 0
	}
	if lon1 < -180 || lon1 > 180 || lon2 < -180 || lon2 > 180 {
		log.Warnf("Invalid longitude values: lon1=%.6f, lon2=%.6f", lon1, lon2)
		return 0
	}

	dLat := (lat2 - lat1) * math.Pi / 180
	dLon := (lon2 - lon1) * math.Pi / 180

	a := math.Sin(dLat/2)*math.Sin(dLat/2) +
		math.Cos(lat1*math.Pi/180)*math.Cos(lat2*math.Pi/180)*
			math.Sin(dLon/2)*math.Sin(dLon/2)
	c := 2 * math.Atan2(math.Sqrt(a), math.Sqrt(1-a))

	return 6371000 * c
}

func getCoordinates(v interface{}) []float64 {
	switch coords := v.(type) {
	case []float64:
		return coords
	case []interface{}:
		result := make([]float64, 0, len(coords))
		for _, c := range coords {
			result = append(result, getFloatValue(c))
		}
		return result
	}
	return nil
}

func getIntValue(v interface{}) (int, bool) {
	switch val := v.(type) {
	case int:
		return val, true
	case float64:
		return int(val), true
	case string:
		var i int
		if _, err := fmt.Sscanf(val, "%d", &i); err == nil {
			return i, true
		}
	}
	return 0, false
}

func getFloatValue(v interface{}) float64 {
	switch val := v.(type) {
	case float64:
		return val
	case int:
		return float64(val)
	}
	return 0
}

func getStringValue(v interface{}) string {
	if s, ok := v.(string); ok {
		return s
	}
	return ""
}

// calculateYearlyDemandFromArea calculates yearly electricity demand based on building type and area
func specificDemandForFClass(fClass string) float64 {
	norm := normalizeFClass(fClass)
	if demand, ok := specificDemandByFClass[norm]; ok {
		return demand
	}

	switch inferCategoryFromFClass(norm) {
	case "public":
		return 45.0
	case "industrial":
		return 55.0
	case "agricultural":
		return 30.0
	case "commercial":
		return 75.0
	default:
		return 35.0
	}
}

