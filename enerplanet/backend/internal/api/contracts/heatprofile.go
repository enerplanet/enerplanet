package contracts

// --- Model heat-profile poll endpoint ---

// BuildingHeatProfile is one building's BuEM-resolved annual energy profile,
// or its resolution status when not yet resolved. hot_water_kwh_a and
// kitchen_kwh_a stay null until buem-gateway's response contract exposes
// them.
type BuildingHeatProfile struct {
	OSMID              string   `json:"osm_id" example:"240054621"`
	Status             string   `json:"status" example:"resolved"`
	TabulaVariantCode  *string  `json:"tabula_variant_code,omitempty" example:"DE.N.SFH.05.Gen.ReEx.001.001"`
	RefurbishmentLevel string   `json:"refurbishment_level" example:"existing"`
	HeatingKwhA        *float64 `json:"heating_kwh_a,omitempty" example:"4823.5"`
	CoolingKwhA        *float64 `json:"cooling_kwh_a,omitempty" example:"312.4"`
	ElectricityKwhA    *float64 `json:"electricity_kwh_a,omitempty" example:"2105.0"`
	HotWaterKwhA       *float64 `json:"hot_water_kwh_a,omitempty"`
	KitchenKwhA        *float64 `json:"kitchen_kwh_a,omitempty"`
	ErrorMessage       *string  `json:"error_message,omitempty" example:"no City2TABULA envelope for this building"`
}

// ModelHeatProfilesResponse is the response for GET /models/{id}/heat-profiles.
//
// status is one of:
//   - idle: no resolution run has been started for this model yet
//   - resolving: a run is in progress (some buildings still pending)
//   - completed: every building has a terminal outcome (resolved or failed)
type ModelHeatProfilesResponse struct {
	Status    string                `json:"status" example:"resolving"`
	Total     int64                 `json:"total" example:"42"`
	Resolved  int64                 `json:"resolved" example:"30"`
	Pending   int64                 `json:"pending" example:"10"`
	Failed    int64                 `json:"failed" example:"2"`
	Buildings []BuildingHeatProfile `json:"buildings"`
}
