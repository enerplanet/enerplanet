package contracts

// --- Heat-demand resolve endpoint ---

// HeatDemandResolveRequest is the POST /api/v1/heat-demand/resolve body. It
// carries what the simple building form collects. f_class drives the fallback
// estimate and the residential test; building_type / construction_year /
// country feed the TABULA path once it is wired.
type HeatDemandResolveRequest struct {
	OSMID            string  `json:"osm_id" example:"240054621"`
	FClass           string  `json:"f_class" example:"detached"`
	BuildingType     string  `json:"building_type,omitempty" example:"SFH"`
	ConstructionYear *int    `json:"construction_year,omitempty" example:"1975"`
	FloorAreaM2      float64 `json:"floor_area_m2" example:"120"`
	Country          string  `json:"country,omitempty" example:"germany"`
}

// HeatDemandInputsEcho repeats the inputs a resolution used, so the caller can
// show what produced the number.
type HeatDemandInputsEcho struct {
	FClass           string  `json:"f_class"`
	BuildingType     string  `json:"building_type,omitempty"`
	ConstructionYear *int    `json:"construction_year,omitempty"`
	FloorAreaM2      float64 `json:"floor_area_m2"`
	Country          string  `json:"country,omitempty"`
}

// HeatDemandProfileSummary is the per-vector rollup of a BuEM hourly profile.
// Populated only when source is "buem".
type HeatDemandProfileSummary struct {
	HeatingTotalKwh     float64 `json:"heating_total_kwh"`
	CoolingTotalKwh     float64 `json:"cooling_total_kwh"`
	ElectricityTotalKwh float64 `json:"electricity_total_kwh"`
	PeakHeatingKw       float64 `json:"peak_heating_kw"`
	PeakCoolingKw       float64 `json:"peak_cooling_kw"`
}

// HeatDemandHourlyProfile references a BuEM hourly series. Null unless source
// is "buem".
type HeatDemandHourlyProfile struct {
	ResolutionMinutes int                      `json:"resolution_minutes"`
	Start             string                   `json:"start"`
	Vectors           []string                 `json:"vectors"`
	TimeseriesRef     string                   `json:"timeseries_ref"`
	Summary           HeatDemandProfileSummary `json:"summary"`
}

// HeatDemandResolveResponse is the resolved demand and its provenance. Every
// field is present so the frontend and the later ignis / BuEM paths do not
// need the shape to change: today source is always "estimate", TabulaVariantCode
// and HourlyProfile are null.
type HeatDemandResolveResponse struct {
	OSMID                       string                   `json:"osm_id"`
	Source                      string                   `json:"source" example:"estimate"`
	HeatingDemandKwhA           int64                    `json:"heating_demand_kwh_a" example:"12000"`
	SpecificHeatingDemandKwhM2a float64                  `json:"specific_heating_demand_kwh_m2a" example:"100"`
	TabulaVariantCode           *string                  `json:"tabula_variant_code"`
	HourlyProfile               *HeatDemandHourlyProfile `json:"hourly_profile"`
	InputsEchoed                HeatDemandInputsEcho     `json:"inputs_echoed"`
	Warnings                    []string                 `json:"warnings"`
}
