// Authoritative registry that maps dashboard data domains to source paths in the
// BUEM / EnerPlanET GeoJSON feature. When schema paths change, update them here
// and keep extraction code generic.
//
// Each path is either:
// - a dot-separated JSON path from the feature root
// - or an ordered list of fallback paths when multiple source shapes are supported
//
// The dashboard is organised into three integration-facing domains:
// - geometry      — physical building geometry and footprint sources
// - thematic      — building identity, envelope and model outputs
// - technologies  — installed technology configuration nodes

export type ModelDataPath = string | readonly string[];

export const MODEL_DATA_MAP = {

  // ── Thematic data ───────────────────────────────────────────────────────────
  // Source: BUEM GeoJSON FeatureCollection -> features[n]
  thematic: {
    // Identity available to the dashboard header and snapshot cards.
    buildingId:  'id',
    label:       'id',
    coordinates: 'geometry.coordinates',                                  // [lon, lat] or [lon, lat, elevation]

    // Descriptor data  (properties.buem.building.*)
    descriptor: {
      buildingTypeCode: [
        'properties.buem.building.building_type',                         // BUEM response shape
        'properties.buem.building.type',                                  // EnerPlanET topology shape
      ],
      constructionYear:  'properties.buem.building.construction_period',   // holds a plain year string, see buemAdapter
      country:            'properties.buem.building.country',
      floorArea:          'properties.buem.building.A_ref',               // { value, unit: "m2" }
      roomHeight:         'properties.buem.building.h_room',              // { value, unit: "m" }
      storeys:            'properties.buem.building.n_storeys',
    },

    // Envelope element list (properties.buem.building.envelope.elements[])
    envelope: {
      elements: 'properties.buem.building.envelope.elements',
    },

    // Thermal output from BUEM response.
    results: {
      heatingTotal:     'properties.buem.thermal_load_profile.summary.heating.total',
      coolingTotal:     'properties.buem.thermal_load_profile.summary.cooling.total',
      electricityTotal: 'properties.buem.thermal_load_profile.summary.electricity.total',
      dhwTotal:         'properties.buem.thermal_load_profile.summary.hot_water.total',
      kitchenTotal:     'properties.buem.thermal_load_profile.summary.kitchen.total',
      totalEnergyDemand: 'properties.buem.thermal_load_profile.summary.total_energy_demand',
      peakHeatingLoad:  'properties.buem.thermal_load_profile.summary.peak_heating_load',
      peakCoolingLoad:  'properties.buem.thermal_load_profile.summary.peak_cooling_load',
      energyIntensity:  'properties.buem.thermal_load_profile.summary.energy_intensity',
      timeseries:       'properties.buem.thermal_load_profile.timeseries',
    },
  },

  // ── Geometry data ─────────────────────────────────────────────────────────────
  // Source: separate GeoJSON building footprint layer
  geometry: {
    buildingId:        ['properties.id', 'id'],
    buildingFootprint: 'geometry',          // Polygon or MultiPolygon
    buildingHeight:    'properties.height', // metres above ground, if available
  },

  // ── Technology data ─────────────────────────────────────────────────────────
  technologies: {
    techRoot: ['techs', 'properties.techs'],
    catalog: {
      solar_pv: ['techs.pv_supply', 'properties.techs.pv_supply'],
      battery: ['techs.battery_storage', 'properties.techs.battery_storage'],
      heat_pump: [
        'techs.heat_pump_supply',
        'properties.techs.heat_pump_supply',
        'techs.heat_pump',
        'properties.techs.heat_pump',
      ],
      ev_charger: ['techs.ev_charger', 'properties.techs.ev_charger'],
    },
  },

} as const;
