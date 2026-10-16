package buem

import (
	"encoding/json"
	"errors"
	"fmt"

	"spatialhub_backend/internal/contenthash"
)

// requestKeyRecipe names the set of fields RequestKey hashes. Changing what
// goes into the key means changing this value, so keys made the old way stop
// matching instead of being read as current.
const requestKeyRecipe = "buem-request/1"

// SharedInputs are the inputs every building of one BuEM run shares. Build it
// with NewSharedInputs, which hashes the weather once for the whole run.
type SharedInputs struct {
	startDate   string
	endDate     string
	resolution  int
	weatherKey  string
	buemVersion string
}

// NewSharedInputs prepares the shared part of the request key: the period and
// resolution as sent to buem-gateway, a hash of the weather block, and the BuEM
// build that computes the result. buemVersion carries the release and, where
// known, the commit, since images built from a branch all report the same
// version. An empty buemVersion is an error, since a key without it would let
// one BuEM build's results pass as another's.
func NewSharedInputs(weather json.RawMessage, startDate, endDate string, resolution int, buemVersion string) (SharedInputs, error) {
	if buemVersion == "" {
		return SharedInputs{}, errors.New("buem version is required for the request key")
	}
	weatherKey, err := contenthash.Of(weather)
	if err != nil {
		return SharedInputs{}, fmt.Errorf("hash weather: %w", err)
	}
	if resolution <= 0 {
		resolution = defaultResolution
	}
	return SharedInputs{
		startDate:   startDate,
		endDate:     endDate,
		resolution:  resolution,
		weatherKey:  weatherKey,
		buemVersion: buemVersion,
	}, nil
}

// RequestKey returns the key a building's BuEM result is stored under: a hash
// of everything sent to buem-gateway that can change the result. The building
// id is part of it, since BuEM seeds a building's occupancy profile from its
// id. model_id and keep_timeseries are not, since they leave the result as is.
func RequestKey(b Building, s SharedInputs) (string, error) {
	if s.buemVersion == "" {
		return "", errors.New("shared inputs not prepared: use NewSharedInputs")
	}
	// Hash the block as run sends it, so a building with no comfort band and
	// one set to the default band get the same key.
	block, err := withDefaultComfortBand(b.Building)
	if err != nil {
		return "", fmt.Errorf("building %s: %w", b.ID, err)
	}
	inputs := map[string]any{
		"recipe":       requestKeyRecipe,
		"buem_version": s.buemVersion,
		"start_date":   s.startDate,
		"end_date":     s.endDate,
		"resolution":   s.resolution,
		"weather":      s.weatherKey,
		"id":           b.ID,
		"geometry":     b.Geometry,
		"building":     block,
		"solver":       b.Solver,
	}
	// Added only when set, so a building without outputs keeps the key it was
	// stored under before outputs existed.
	if len(b.Outputs) > 0 {
		inputs["outputs"] = b.Outputs
	}
	return contenthash.Of(inputs)
}
