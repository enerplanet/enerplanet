package buem

import (
	"encoding/json"
	"fmt"
)

// The comfort band sent when a building block sets none: BuEM's own
// recommended residential default. Without it BuEM's API applies 21-24 °C.
const (
	defaultComfortLowerC = 18.0
	defaultComfortUpperC = 21.0
)

// withDefaultComfortBand sets building.thermal.comfortT_lb and comfortT_ub to
// the default band. A block that sets either bound already is returned as it
// is, so a band a user chose is never mixed with a default bound.
func withDefaultComfortBand(block json.RawMessage) (json.RawMessage, error) {
	var b map[string]any
	if err := json.Unmarshal(block, &b); err != nil {
		return nil, fmt.Errorf("decode building block: %w", err)
	}
	thermal, ok := b["thermal"].(map[string]any)
	if !ok && b["thermal"] != nil {
		return nil, fmt.Errorf("building.thermal is %T, want an object", b["thermal"])
	}
	if thermal == nil {
		thermal = map[string]any{}
	}
	if _, set := thermal["comfortT_lb"]; set {
		return block, nil
	}
	if _, set := thermal["comfortT_ub"]; set {
		return block, nil
	}
	thermal["comfortT_lb"] = map[string]any{"value": defaultComfortLowerC, "unit": "degC"}
	thermal["comfortT_ub"] = map[string]any{"value": defaultComfortUpperC, "unit": "degC"}
	b["thermal"] = thermal
	return json.Marshal(b)
}
