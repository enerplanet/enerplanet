package payload

import (
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"time"

	"platform.local/common/pkg/models"
	"platform.local/platform/logger"
)

// CalculationPayload defines the structure for the calculation request to ensure fixed field ordering in JSON.
type CalculationPayload struct {
	UserID                 string                 `json:"user_id"`
	ModelID                string                 `json:"model_id"`
	SessionID              string                 `json:"session_id"`
	Country                string                 `json:"country"`
	Lkr                    string                 `json:"lkr"`
	CallbackURL            string                 `json:"callback_url"`
	StartDate              string                 `json:"start_date"`
	EndDate                string                 `json:"end_date"`
	Resolution             int                    `json:"resolution"`
	EnergyVectors          []string               `json:"energy_vectors,omitempty"`
	CustomDemandTimeSeries []interface{}          `json:"custom_demand_time_series,omitempty"`
	Topology               []interface{}          `json:"topology,omitempty"`
	Pypsa                  map[string]interface{} `json:"pypsa,omitempty"`
	Parameters             map[string]interface{} `json:"parameters,omitempty"`
}

// ErrMissingCountry is returned by BuildCalculationPayload when the model
// has no resolved country. Callers should surface this as a 400.
var ErrMissingCountry = fmt.Errorf("model country is not set; cannot build calculation payload")

// BuildCalculationPayload constructs the payload for the Calliope webservice.
// Returns an error if mandatory derived fields (currently: country) are missing.
func BuildCalculationPayload(model *models.Model) (interface{}, error) {
	if model.Country == nil || strings.TrimSpace(*model.Country) == "" {
		return nil, ErrMissingCountry
	}

	callbackURL := buildCallbackURL(model.ID)
	// Use timestamp to make model_id unique per run (allows re-runs)
	runTimestamp := time.Now().Unix()
	sessionID := getSessionID(model.ID, runTimestamp)
	uniqueModelID := fmt.Sprintf("%d_%d", model.ID, runTimestamp)
	resolution := getResolution(model)

	payload := CalculationPayload{
		UserID:      model.UserID,
		ModelID:     uniqueModelID,
		SessionID:   fmt.Sprintf("%d", sessionID),
		CallbackURL: callbackURL,
		StartDate:   model.FromDate.Format("2006-01-02T15:04:05.000Z"),
		EndDate:     model.ToDate.Format("2006-01-02T15:04:05.000Z"),
		Resolution:  resolution,
		Country:     *model.Country,
		Lkr:         derefOrEmpty(model.Region),
	}

	// Parse config
	var configMap map[string]interface{}
	if len(model.Config) > 0 && json.Unmarshal(model.Config, &configMap) == nil {
		// Extract energy vectors from config (default: ["electricity"])
		if vectors, ok := configMap["energyVectors"].([]interface{}); ok {
			for _, v := range vectors {
				if s, ok := v.(string); ok {
					payload.EnergyVectors = append(payload.EnergyVectors, s)
				}
			}
		}
		if isPylovoConfig(configMap) {
			if len(payload.EnergyVectors) == 0 {
				payload.EnergyVectors = []string{"electricity"}
			}
			return buildPylovoPayload(payload, configMap, sessionID), nil
		}
	}

	// Default to electricity-only if not specified
	if len(payload.EnergyVectors) == 0 {
		payload.EnergyVectors = []string{"electricity"}
	}

	return buildLegacyPayload(model, payload, configMap), nil
}

func buildCallbackURL(modelID uint) string {
	callbackBaseURL := os.Getenv("CALLBACK_URL")
	if callbackBaseURL == "" {
		callbackBaseURL = os.Getenv("APP_URL")
		if callbackBaseURL != "" {
			callbackBaseURL = strings.Replace(callbackBaseURL, "https://", "http://", 1)
		}
	}
	if callbackBaseURL == "" {
		callbackBaseURL = "http://backend:8000"
	}
	return fmt.Sprintf("%s/api/v1/calculation/callback/%d", callbackBaseURL, modelID)
}

func getSessionID(modelID uint, runTimestamp int64) int64 {
	// Combine model ID and timestamp for unique session ID
	return int64(modelID)*1000000000 + runTimestamp%1000000000
}

func getResolution(model *models.Model) int {
	if model.Resolution != nil {
		return *model.Resolution
	}
	return 60
}

func derefOrEmpty(s *string) string {
	if s == nil {
		return ""
	}
	return *s
}

func isPylovoConfig(cfg map[string]interface{}) bool {
	_, hasBuildings := cfg["buildings"]
	_, hasLines := cfg["lines"]
	_, hasTransformers := cfg["transformers"]
	return hasBuildings || hasLines || hasTransformers
}

// Default cable and transformer type constants
const (
	defaultLineTypeLV = "NAYY 4x150 SE"
	defaultLineTypeMV = "NA2XS2Y 1x185 RM/25 12/20 kV"
	defaultTrafoType  = "0.4 MVA 20/0.4 kV"
)

// extractCableTypeFromFeatures extracts the first cable_type from a GeoJSON feature collection
func extractCableTypeFromFeatures(configMap map[string]interface{}, key string) string {
	fc, ok := configMap[key].(map[string]interface{})
	if !ok {
		return ""
	}
	features, ok := fc["features"].([]interface{})
	if !ok || len(features) == 0 {
		return ""
	}
	for _, f := range features {
		if cableType := extractCableTypeFromFeature(f); cableType != "" {
			return cableType
		}
	}
	return ""
}

// extractCableTypeFromFeature extracts cable_type from a single feature
func extractCableTypeFromFeature(f interface{}) string {
	fMap, ok := f.(map[string]interface{})
	if !ok {
		return ""
	}
	props, ok := fMap["properties"].(map[string]interface{})
	if !ok {
		return ""
	}
	if cableType, ok := props["cable_type"].(string); ok && cableType != "" {
		return cableType
	}
	return ""
}

// extractTrafoTypeFromConfig extracts transformer type from config based on rated power
func extractTrafoTypeFromConfig(configMap map[string]interface{}) string {
	transformers, ok := configMap["transformers"].(map[string]interface{})
	if !ok {
		return ""
	}
	features, ok := transformers["features"].([]interface{})
	if !ok || len(features) == 0 {
		return ""
	}
	for _, t := range features {
		if trafoType := extractTrafoTypeFromFeature(t); trafoType != "" {
			return trafoType
		}
	}
	return ""
}

// extractTrafoTypeFromFeature extracts trafo type from a single transformer feature
func extractTrafoTypeFromFeature(t interface{}) string {
	tMap, ok := t.(map[string]interface{})
	if !ok {
		return ""
	}
	props, ok := tMap["properties"].(map[string]interface{})
	if !ok {
		return ""
	}
	if ratedPower := getFloatValue(props["rated_power_kva"]); ratedPower > 0 {
		return mapRatedPowerToTrafoType(ratedPower)
	}
	return ""
}

// buildDefaultPypsaConfig builds pypsa config from extracted values with defaults
func buildDefaultPypsaConfig(configMap map[string]interface{}) map[string]interface{} {
	lineTypeLV := extractCableTypeFromFeatures(configMap, "lines")
	if lineTypeLV == "" {
		lineTypeLV = defaultLineTypeLV
	}

	lineTypeMV := extractCableTypeFromFeatures(configMap, "mv_lines")
	if lineTypeMV == "" {
		lineTypeMV = defaultLineTypeMV
	}

	trafoType := extractTrafoTypeFromConfig(configMap)
	if trafoType == "" {
		trafoType = defaultTrafoType
	}

	return map[string]interface{}{
		"trafo_mv_lv_used": true,
		"trafo_mv_lv_type": trafoType,
		"line_type_mv":     lineTypeMV,
		"line_type_lv":     lineTypeLV,
	}
}

func buildPylovoPayload(payload CalculationPayload, configMap map[string]interface{}, sessionID int64) CalculationPayload {
	// Build topology
	if topology := buildTopologyFromPylovoData(configMap, sessionID); len(topology) > 0 {
		payload.Topology = topology
	}

	// pypsa config - use existing or build from extracted values
	if pypsa, ok := configMap["pypsa"].(map[string]interface{}); ok {
		payload.Pypsa = pypsa
	} else {
		payload.Pypsa = buildDefaultPypsaConfig(configMap)
	}

	return payload
}

// mapRatedPowerToTrafoType maps rated power (kVA) to trafo type string
// Supports standard transformer sizes: 100, 160, 250, 400, 630, 800, 1000, 1250, 1600, 2000, 2500 kVA
func mapRatedPowerToTrafoType(ratedPowerKVA float64) string {
	log := logger.ForComponent("payload")

	if ratedPowerKVA <= 0 {
		log.Warnf("Invalid transformer rated power: %.2f kVA, using default 0.4 MVA", ratedPowerKVA)
		return "0.4 MVA 20/0.4 kV"
	}

	switch {
	case ratedPowerKVA <= 100:
		return "0.1 MVA 20/0.4 kV"
	case ratedPowerKVA <= 160:
		return "0.16 MVA 20/0.4 kV"
	case ratedPowerKVA <= 250:
		return "0.25 MVA 20/0.4 kV"
	case ratedPowerKVA <= 400:
		return "0.4 MVA 20/0.4 kV"
	case ratedPowerKVA <= 630:
		return "0.63 MVA 20/0.4 kV"
	case ratedPowerKVA <= 800:
		return "0.8 MVA 20/0.4 kV"
	case ratedPowerKVA <= 1000:
		return "1 MVA 20/0.4 kV"
	case ratedPowerKVA <= 1250:
		return "1.25 MVA 20/0.4 kV"
	case ratedPowerKVA <= 1600:
		return "1.6 MVA 20/0.4 kV"
	case ratedPowerKVA <= 2000:
		return "2 MVA 20/0.4 kV"
	case ratedPowerKVA <= 2500:
		return "2.5 MVA 20/0.4 kV"
	default:
		log.Warnf("Large transformer capacity: %.2f kVA, mapping to 2.5 MVA", ratedPowerKVA)
		return "2.5 MVA 20/0.4 kV"
	}
}

func buildLegacyPayload(model *models.Model, payload CalculationPayload, configMap map[string]interface{}) CalculationPayload {
	payload.Parameters = map[string]interface{}{}

	if configMap != nil {
		if topo, ok := configMap["topology"]; ok {
			if topoList, ok := topo.([]interface{}); ok {
				payload.Topology = topoList
			}
		}
		if pypsa, ok := configMap["pypsa"]; ok {
			if pypsaMap, ok := pypsa.(map[string]interface{}); ok {
				payload.Pypsa = pypsaMap
			}
		}
	}

	// Fallback: simple topology from stored coordinates
	if len(payload.Topology) == 0 && len(model.Coordinates) > 0 {
		topology := []interface{}{
			map[string]interface{}{
				"from": json.RawMessage(fmt.Sprintf("{\"type\":\"Feature\",\"geometry\":%s}", string(model.Coordinates))),
			},
		}
		payload.Topology = topology
	}

	return payload
}

// indexTransformersByGrid indexes transformers by their grid_result_id
