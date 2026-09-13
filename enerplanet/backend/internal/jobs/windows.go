package jobs

// buildingWindowSettings reads the user's window and door overrides from a
// building's properties and returns them as the building.* keys of
// buem-gateway's v6-draft contract: window_to_wall_ratio, window_U,
// window_g_gl and door_U. BuEM uses them when it synthesises the openings
// itself (no explicit window or door elements are sent), in place of the
// TABULA archetype's values. Properties hold plain numbers; U-values are
// wrapped as quantities in W/(m2K), the spelling BuEM's schema accepts.
// A missing or out-of-range value is omitted so BuEM keeps its default,
// the same treatment as capacity and cooking_carrier.
func buildingWindowSettings(props map[string]interface{}) map[string]interface{} {
	out := map[string]interface{}{}
	if v, ok := propFloat(props, "window_to_wall_ratio"); ok && v >= 0 && v < 1 {
		out["window_to_wall_ratio"] = v
	}
	if v, ok := propFloat(props, "window_g_gl"); ok && v >= 0 && v <= 1 {
		out["window_g_gl"] = v
	}
	for _, key := range []string{"window_U", "door_U"} {
		if v, ok := propFloat(props, key); ok && v > 0 {
			out[key] = map[string]interface{}{"value": v, "unit": "W/(m2K)"}
		}
	}
	return out
}

// propFloat reads a numeric property. JSON numbers decode as float64 in a
// map[string]interface{}; int covers values set from Go code.
func propFloat(props map[string]interface{}, key string) (float64, bool) {
	switch v := props[key].(type) {
	case float64:
		return v, true
	case int:
		return float64(v), true
	}
	return 0, false
}
