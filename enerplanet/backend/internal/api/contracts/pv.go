package contracts

// --- Per-building PV yield ---

// PVBuildingYieldRequest is the POST /api/v1/pv/building-yield body: one
// building's PV arrays, where it stands and the weather to use.
type PVBuildingYieldRequest struct {
	OSMID string  `json:"osm_id" example:"240054621"`
	Lat   float64 `json:"lat" example:"48.83"`
	Lon   float64 `json:"lon" example:"12.96"`
	// WeatherProvider, WeatherScenario and WeatherYear choose the weather. Send
	// WeatherScenario or WeatherYear, not both; with neither, the default archive
	// and typical year are used.
	WeatherProvider string `json:"weather_provider,omitempty" enums:"cosmo-rea6,era5-land,merra-2" example:"merra-2"`
	WeatherScenario string `json:"weather_scenario,omitempty" enums:"p10,p50,p90" example:"p50"`
	WeatherYear     int    `json:"weather_year,omitempty" example:"2019"`
	// Module holds the building's PV module settings (losses, dc_ac_ratio,
	// inv_eff, module_type); a missing setting takes the platform default.
	Module map[string]float64 `json:"module,omitempty" swaggertype:"object"`
	Arrays []PVArray          `json:"arrays"`
}

// PVArray is one PV array on a building surface.
type PVArray struct {
	SurfaceID string `json:"surface_id" example:"DEBY_LOD2_105317878_roof_1"`
	// Tilt is the surface's, in degrees from horizontal. Below 5 the surface
	// counts as flat and carries south-facing panels at 15 degrees.
	Tilt float64 `json:"tilt" example:"35"`
	// Azimuth is in degrees clockwise from north; 180 is south.
	Azimuth float64 `json:"azimuth" example:"180"`
	// Area is the surface area in m².
	Area float64 `json:"area" example:"40"`
	// UsableShare is the part of the area with modules, above 0 and at most 1.
	UsableShare float64 `json:"usable_share" example:"0.8"`
	// CapacityKW fixes the array's capacity; omitted, it is 0.2 kW per m² of usable area.
	CapacityKW *float64 `json:"capacity_kw,omitempty" example:"6.4"`
}

// PVBuildingYieldResponse is the building's PV generation over a full calendar
// year of the chosen weather, the span of a BuEM run's totals.
type PVBuildingYieldResponse struct {
	AnnualKWh float64 `json:"annual_kwh" example:"6120.5"`
}
