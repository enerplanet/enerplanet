package pv

import (
	"encoding/json"
	"fmt"
	"math"

	"spatialhub_backend/internal/contenthash"
)

// requestKeyRecipe names the fields RequestKey hashes; bump it when that set changes.
const requestKeyRecipe = "pv-request/1"

// WeatherCellDegrees is the grid PV locations snap to, about 5 km: the
// buildings of one cell share a weather fetch and, for the same roof, a stored
// profile. The sun's position moves by far less than the weather data resolves
// over that distance.
const WeatherCellDegrees = 0.05

// SnapLocation returns the centre of the weather cell holding loc.
func SnapLocation(loc Location) Location {
	snap := func(v float64) float64 {
		centre := (math.Floor(v/WeatherCellDegrees) + 0.5) * WeatherCellDegrees
		return math.Round(centre*1e6) / 1e6
	}
	return Location{Lat: snap(loc.Lat), Lon: snap(loc.Lon)}
}

// SharedInputs are the inputs every array of one weather cell and run shares.
type SharedInputs struct {
	version    string
	weatherKey string
	start, end string
	resolution int
	location   Location
}

// NewSharedInputs hashes the weather once for all arrays of a cell. version is
// the PV service version; an empty one still keys, but then a changed service
// keeps serving the old profiles.
func NewSharedInputs(weather json.RawMessage, loc Location, start, end string, resolution int, version string) (SharedInputs, error) {
	if resolution <= 0 {
		return SharedInputs{}, fmt.Errorf("PV resolution must be positive, got %d minutes", resolution)
	}
	if version == "" {
		return SharedInputs{}, fmt.Errorf("PV service version is not set (PV_VERSION), so PV profiles cannot be keyed")
	}
	weatherKey, err := contenthash.Of(weather)
	if err != nil {
		return SharedInputs{}, fmt.Errorf("hash the PV weather: %w", err)
	}
	return SharedInputs{version: version, weatherKey: weatherKey, start: start, end: end, resolution: resolution, location: loc}, nil
}

// RequestKey identifies the capacity-factor profile of one array: what is sent
// to the PV service, the surface it stands for and the shared inputs. The
// request id is left out, since it names a model's building.
func RequestKey(surfaceID string, a ArrayRequest, s SharedInputs) (string, error) {
	return contenthash.Of(map[string]any{
		"recipe": requestKeyRecipe, "pv_version": s.version, "weather": s.weatherKey,
		"start": s.start, "end": s.end, "resolution": s.resolution, "location": s.location,
		"surface_id": surfaceID, "tilt": a.Tilt, "azimuth": a.Azimuth, "losses": a.Losses,
		"dc_ac_ratio": a.DCACRatio, "inverter_efficiency": a.InverterEfficiency, "module_type": a.ModuleType,
	})
}

// Resample turns an hourly profile into steps of resolution minutes: an hour
// is repeated for shorter steps and averaged for longer ones.
func Resample(hourly []float64, resolution int) []float32 {
	if resolution <= 0 || len(hourly) == 0 {
		return nil
	}
	if resolution <= 60 {
		perHour := 60 / resolution
		out := make([]float32, 0, len(hourly)*perHour)
		for _, v := range hourly {
			for range perHour {
				out = append(out, float32(v))
			}
		}
		return out
	}
	hours := resolution / 60
	out := make([]float32, 0, (len(hourly)+hours-1)/hours)
	for i := 0; i < len(hourly); i += hours {
		end := min(i+hours, len(hourly))
		sum := 0.0
		for _, v := range hourly[i:end] {
			sum += v
		}
		out = append(out, float32(sum/float64(end-i)))
	}
	return out
}
