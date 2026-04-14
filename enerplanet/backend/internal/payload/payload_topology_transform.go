package payload

import (
	"fmt"
	"math"
	"strings"

	"platform.local/platform/logger"
)

func indexTransformersByGrid(transformers []interface{}) map[int]map[string]interface{} {
	log := logger.ForComponent("payload")
	result := make(map[int]map[string]interface{})
	skippedCount := 0

	for i, t := range transformers {
		tMap, ok := t.(map[string]interface{})
		if !ok {
			log.Warnf("Transformer at index %d: invalid format, expected map", i)
			skippedCount++
			continue
		}
		props, ok := tMap["properties"].(map[string]interface{})
		if !ok {
			log.Warnf("Transformer at index %d: missing or invalid properties", i)
			skippedCount++
			continue
		}

		// Validate rated_power_kva
		ratedPower := getFloatValue(props["rated_power_kva"])
		if ratedPower <= 0 {
			osmID := props["osm_id"]
			log.Warnf("Transformer (osm_id=%v) at index %d: missing or invalid rated_power_kva", osmID, i)
		}

		if gridID, ok := getIntValue(props["grid_result_id"]); ok {
			result[gridID] = tMap
		} else {
			osmID := props["osm_id"]
			log.Warnf("Transformer (osm_id=%v) at index %d: missing grid_result_id, skipping", osmID, i)
			skippedCount++
		}
	}

	if skippedCount > 0 {
		log.Warnf("Indexed %d transformers, skipped %d due to missing/invalid data", len(result), skippedCount)
	}
	return result
}

// indexBuildingsByGrid indexes buildings by their grid_result_id
func indexBuildingsByGrid(buildings []interface{}) map[int][]map[string]interface{} {
	log := logger.ForComponent("payload")
	result := make(map[int][]map[string]interface{})
	skippedCount := 0
	missingAreaCount := 0

	for i, bld := range buildings {
		bMap, ok := bld.(map[string]interface{})
		if !ok {
			log.Warnf("Building at index %d: invalid format, expected map", i)
			skippedCount++
			continue
		}
		props, ok := bMap["properties"].(map[string]interface{})
		if !ok {
			log.Warnf("Building at index %d: missing or invalid properties", i)
			skippedCount++
			continue
		}

		// Validate area
		area := getFloatValue(props["area"])
		if area <= 0 {
			missingAreaCount++
		}

		// Validate geometry
		geom, hasGeom := bMap["geometry"].(map[string]interface{})
		if !hasGeom || geom == nil {
			osmID := props["osm_id"]
			log.Warnf("Building (osm_id=%v) at index %d: missing geometry", osmID, i)
		}

		if gridID, ok := getIntValue(props["grid_result_id"]); ok {
			result[gridID] = append(result[gridID], bMap)
		} else {
			// Buildings without grid_result_id are standalone - not an error, just info
			skippedCount++
		}
	}

	totalBuildings := 0
	for _, buildings := range result {
		totalBuildings += len(buildings)
	}

	if skippedCount > 0 || missingAreaCount > 0 {
		log.Infof("Indexed %d buildings across %d grids, %d standalone buildings, %d with missing area",
			totalBuildings, len(result), skippedCount, missingAreaCount)
	}
	return result
}

// createTopologyNode creates a topology node from a transformer feature
func createTopologyNode(gridID int, transformer map[string]interface{}, sessionID int64) map[string]interface{} {
	trafoGeom, _ := transformer["geometry"].(map[string]interface{})
	trafoProps, _ := transformer["properties"].(map[string]interface{})
	ratedPower := getFloatValue(trafoProps["rated_power_kva"])
	topologyNodeID := fmt.Sprintf("trafo_%d", gridID)

	return map[string]interface{}{
		"type":     "Feature",
		"geometry": trafoGeom,
		"id":       topologyNodeID,
		"properties": map[string]interface{}{
			"id":              topologyNodeID,
			"osm_id":          fmt.Sprintf("Trafo_%d", gridID),
			"feature_type":    "TopologyNode",
			"f_class":         "transformer",
			"f_class_demands": nil,
			"area":            nil,
			"demand_energy":   0,
			"demand_heat":     0,
			"created_at":      nil,
			"modified_at":     nil,
			"rated_power":     ratedPower,
			"session_id":      fmt.Sprintf("%d", sessionID),
		},
		"techs":                    nil,
		"custom_demand_timeseries": nil,
	}
}

// createBuildingFeature creates a building feature from building data
func createBuildingFeature(building map[string]interface{}, poiID int, sessionID int64) map[string]interface{} {
	log := logger.ForComponent("payload")
	bGeom, _ := building["geometry"].(map[string]interface{})
	bProps, _ := building["properties"].(map[string]interface{})

	osmID := fmt.Sprintf("%v", bProps["osm_id"])
	fClasses := extractBuildingFClasses(bProps)
	primaryClass := selectPrimaryBuildingFClass(fClasses)
	selectedFClass := resolveSelectedBuildingFClass(bProps, fClasses)
	area := getFloatValue(bProps["area"])
	explicitDemand := getFloatValue(bProps["yearly_demand_kwh"])
	if explicitDemand <= 0 {
		explicitDemand = getFloatValue(bProps["demand_energy"])
	}

	fClassDemands, yearlyDemandInt := calculateYearlyDemandPerFClass(
		fClasses,
		area,
		bProps["f_class_demands"],
		explicitDemand,
	)
	if len(fClassDemands) == 0 {
		fClassDemands, yearlyDemandInt = calculateYearlyDemandPerFClass(
			fClasses,
			area,
			bProps["fclass_details"],
			explicitDemand,
		)
	}
	if selectedFClass != "" {
		filteredDemands, filteredTotal := filterDemandsBySelectedFClass(fClassDemands, selectedFClass)
		if len(filteredDemands) > 0 {
			fClassDemands = filteredDemands
			yearlyDemandInt = filteredTotal
		} else {
			selectedDemand := explicitDemand
			if selectedDemand <= 0 && area > 0 {
				selectedDemand = area * specificDemandForFClass(selectedFClass)
			}
			selectedDemandInt := int64(math.Round(selectedDemand))
			if selectedDemandInt < 0 {
				selectedDemandInt = 0
			}
			fClassDemands = []map[string]interface{}{
				{
					"demand_energy": selectedDemandInt,
					"profile":       demandProfileForFClass(selectedFClass),
				},
			}
			yearlyDemandInt = selectedDemandInt
		}
		fClasses = []string{selectedFClass}
		primaryClass = selectedFClass
	}
	demandProfile := demandProfileForFClass(primaryClass)
	techs := extractAndTransformTechs(bProps)

	// Convert geometry to point, with fallback to original geometry
	pointGeom, err := convertToPointGeometry(bGeom)
	if err != nil {
		log.Warnf("Building (osm_id=%s): failed to convert geometry to point: %v, using original", osmID, err)
		pointGeom = bGeom
	}

	return map[string]interface{}{
		"type":     "Feature",
		"geometry": pointGeom,
		"id":       fmt.Sprintf("%d", poiID),
		"properties": map[string]interface{}{
			"id":              fmt.Sprintf("%d", poiID),
			"feature_type":    "BasePOI",
			"type":            primaryClass,
			"f_class":         primaryClass,
			"f_class_demands": fClassDemands,
			"osm_id":          osmID,
			"area":            area,
			"demand_profile":  demandProfile,
			"demand_energy":   yearlyDemandInt,
			"demand_heat":     0,
			"created_at":      nil,
			"modified_at":     nil,
			"session_id":      fmt.Sprintf("%d", sessionID),
		},
		"techs":                    techs,
		"custom_demand_timeseries": nil,
	}
}

// getBuildingGeometry extracts geometry from a building map
func getBuildingGeometry(building map[string]interface{}) map[string]interface{} {
	geom, _ := building["geometry"].(map[string]interface{})
	return geom
}

// getTransformerGeometry extracts geometry from a transformer map
func getTransformerGeometry(transformer map[string]interface{}) map[string]interface{} {
	geom, _ := transformer["geometry"].(map[string]interface{})
	return geom
}

func buildTopologyFromPylovoData(configMap map[string]interface{}, sessionID int64) []interface{} {
	var topology []interface{}

	buildings := getFeatures(configMap, "buildings")
	transformers := getFeatures(configMap, "transformers")
	mvLines := getFeatures(configMap, "mv_lines")

	transformerMap := indexTransformersByGrid(transformers)
	buildingsByGrid := indexBuildingsByGrid(buildings)

	// Create a map of transformer grid_result_id to topology node for MV line connections
	trafoNodesByGridID := make(map[int]map[string]interface{})

	poiID := 0

	// Create topology nodes for buildings connected to transformers
	for gridID, transformer := range transformerMap {
		buildingsInGrid := buildingsByGrid[gridID]
		if len(buildingsInGrid) == 0 {
			continue
		}

		topologyNode := createTopologyNode(gridID, transformer, sessionID)
		trafoGeom := getTransformerGeometry(transformer)

		// Store topology node by grid_result_id for MV line connections
		trafoNodesByGridID[gridID] = topologyNode

		for _, building := range buildingsInGrid {
			poiID++
			fromFeature := createBuildingFeature(building, poiID, sessionID)
			bGeom := getBuildingGeometry(building)
			lengthMeters := calculateDistance(bGeom, trafoGeom)

			topology = append(topology, map[string]interface{}{
				"from":   fromFeature,
				"to":     topologyNode,
				"length": lengthMeters / 1000.0, // Convert meters to kilometers for PyPSA
				"pipe":   "lv",
			})
		}
	}

	// Add MV lines connecting transformers
	for _, mvLine := range mvLines {
		mvMap, ok := mvLine.(map[string]interface{})
		if !ok {
			continue
		}
		props, ok := mvMap["properties"].(map[string]interface{})
		if !ok {
			continue
		}

		fromTrafoID := int(getFloatValue(props["from_transformer"]))
		toTrafoID := int(getFloatValue(props["to_transformer"]))
		lengthKm := getFloatValue(props["length_km"])

		fromNode, hasFrom := trafoNodesByGridID[fromTrafoID]
		toNode, hasTo := trafoNodesByGridID[toTrafoID]

		if hasFrom && hasTo {
			topology = append(topology, map[string]interface{}{
				"from":   fromNode,
				"to":     toNode,
				"length": lengthKm, // Already in kilometers for PyPSA
				"pipe":   "mv",
			})
		}
	}

	// Handle standalone buildings (no transformer)
	for _, bld := range buildings {
		bMap, ok := bld.(map[string]interface{})
		if !ok {
			continue
		}
		bProps, _ := bMap["properties"].(map[string]interface{})
		if gridID, ok := getIntValue(bProps["grid_result_id"]); ok {
			if _, hasTransformer := transformerMap[gridID]; hasTransformer {
				continue
			}
		}

		poiID++
		fromFeature := createBuildingFeature(bMap, poiID, sessionID)
		topology = append(topology, map[string]interface{}{"from": fromFeature})
	}

	return topology
}

// nullDefaultFields maps field keys to their default string value when null
var nullDefaultFields = map[string]string{}

// processConstraintValue converts and normalizes a constraint value
func processConstraintValue(key string, value interface{}) interface{} {
	if value == nil {
		if def, ok := nullDefaultFields[key]; ok {
			return def
		}
	}
	value = convertSelectFieldToNumeric(key, value)
	if infinityFields[key] {
		return normalizeInfinityValueWithDefault(value)
	}
	return normalizeInfinityValue(value)
}

// extractConstraintsFromArray extracts key-value pairs from constraints array format
func extractConstraintsFromArray(constraints []interface{}) map[string]interface{} {
	result := make(map[string]interface{})
	for _, c := range constraints {
		cMap, ok := c.(map[string]interface{})
		if !ok {
			continue
		}
		k, ok := cMap["key"].(string)
		if !ok {
			continue
		}
		result[k] = processConstraintValue(k, cMap["value"])
	}
	return result
}

// extractConstraintsFromMap extracts key-value pairs from direct map format
func extractConstraintsFromMap(techObj map[string]interface{}) map[string]interface{} {
	result := make(map[string]interface{})
	excludeKeys := map[string]bool{"alias": true, "icon": true, "constraints": true}
	for k, v := range techObj {
		if excludeKeys[k] {
			continue
		}
		result[k] = processConstraintValue(k, v)
	}
	return result
}

// transformTechObject transforms a single technology object
func transformTechObject(techObj map[string]interface{}) map[string]interface{} {
	if constraints, ok := techObj["constraints"].([]interface{}); ok {
		return extractConstraintsFromArray(constraints)
	}
	return extractConstraintsFromMap(techObj)
}

func extractAndTransformTechs(bProps map[string]interface{}) interface{} {
	t, ok := bProps["techs"]
	if !ok {
		return nil
	}

	tMap, ok := t.(map[string]interface{})
	if !ok {
		return t
	}

	transformedTechs := make(map[string]interface{})
	for techName, techData := range tMap {
		techObj, ok := techData.(map[string]interface{})
		if !ok {
			continue
		}
		if newTechObj := transformTechObject(techObj); len(newTechObj) > 0 {
			transformedTechs[techName] = newTechObj
		}
	}

	if len(transformedTechs) > 0 {
		return transformedTechs
	}
	return nil
}

// selectFieldOptions maps select field keys to their string options (1-indexed)
var selectFieldOptions = map[string][]string{
	"combustor_type": {"Grate Stoker Furnace", "Fluidized Bed Combustor", "Cyclone Furnace"},
	"feedstock_type": {"forest", "woody", "mill", "urban", "stover", "wheat", "barley", "rice", "bagasse", "herb"},
}

// convertSelectFieldToNumeric converts string option values to their numeric index (1-based)
func convertSelectFieldToNumeric(key string, value interface{}) interface{} {
	options, isSelectField := selectFieldOptions[key]
	if !isSelectField {
		return value
	}

	// If already numeric, return as-is
	switch v := value.(type) {
	case float64:
		return v
	case int:
		return v
	case string:
		// Find the index of the string option (1-based)
		for i, opt := range options {
			if opt == v {
				return i + 1 // Return 1-based index
			}
		}
		// If not found, return default (1)
		return 1
	case nil:
		// Return default (1) for nil values
		return 1
	default:
		return value
	}
}

// normalizeInfinityValue converts various infinity representations to "inf" for Python compatibility
func normalizeInfinityValue(value interface{}) interface{} {
	if value == nil {
		return nil
	}

	switch v := value.(type) {
	case string:
		upper := strings.ToUpper(v)
		if upper == "INF" || upper == "INFINITY" || v == "∞" {
			return "inf"
		}
		return v
	case float64:
		if math.IsInf(v, 1) {
			return "inf"
		}
		if math.IsInf(v, -1) {
			return "-inf"
		}
		return v
	default:
		return value
	}
}

// normalizeInfinityValueWithDefault converts infinity, null, or empty string to "inf" for fields that should default to infinity
func normalizeInfinityValueWithDefault(value interface{}) interface{} {
	if value == nil {
		return "inf"
	}
	// Handle empty string as infinity
	if str, ok := value.(string); ok && str == "" {
		return "inf"
	}
	return normalizeInfinityValue(value)
}

// infinityFields is a set of constraint keys that should default to "inf" when null
var infinityFields = map[string]bool{
	"cont_energy_cap_max_systemwide": true,
	"cont_export_cap":                true,
	"cont_resource_area_max":         true,
	"cont_resource_cap_max":          true,
}
