package resultservice

// mwToKw converts a power value from megawatts to kilowatts.
//
// The MEME/Coati result pipeline (Calliope CSVs and the Coati document) reports
// power in MW, while the R2 result contract — the one the store and frontend
// were built against (legacy stored kW) — is kW. Every power column is therefore
// scaled ONCE here, at the mapping boundary, so no consumer needs to change.
//
// Only POWER is scaled. Ratios (capacity_factor), unit costs (€/kWh levelised
// costs), currency (cost/cost_var) and identifiers (loc_techs/coordinates) are
// left untouched.
func mwToKw(v float64) float64 { return v * 1000 }
