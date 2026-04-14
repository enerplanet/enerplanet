// Tooltip keys for translation lookup
export const TOOLTIP_KEYS = {
  multiplePolygons: 'tooltips.multiplePolygons',
  publicBuildings: 'tooltips.publicBuildings',
  privateBuildings: 'tooltips.privateBuildings',
  simulateEV: 'tooltips.simulateEV',
  gridConstrained: 'tooltips.gridConstrained',
  buildingEnrichment: 'tooltips.buildingEnrichment',
  bagFloors: 'tooltips.bagFloors',
  bagId: 'tooltips.bagId',
  energyLabel: 'tooltips.energyLabel',
  cbsPopulation: 'tooltips.cbsPopulation',
  cbsHouseholds: 'tooltips.cbsHouseholds',
  cbsAvgHouseholdSize: 'tooltips.cbsAvgHouseholdSize',
  scenario: 'tooltips.scenario',
  co2_limit: 'tooltips.co2_limit',
  max_hours: 'tooltips.max_hours',
  solver: 'tooltips.solver',
  autarky: 'tooltips.autarky',
  solarPotential: 'tooltips.solarPotential',
  area: 'tooltips.area',
  perimeter: 'tooltips.perimeter',
  estGeneration: 'tooltips.estGeneration',
  co2Offset: 'tooltips.co2Offset',
  voltageStatus: 'tooltips.voltageStatus',
  pypsaSimulation: 'tooltips.pypsaSimulation',
  powerFlow: 'tooltips.powerFlow',
  addTransformer: 'tooltips.addTransformer',
  assignBuildings: 'tooltips.assignBuildings',
  buildingType: 'tooltips.buildingType',
  constructionYear: 'tooltips.constructionYear',
  floorArea: 'tooltips.floorArea',
  buildingHeight: 'tooltips.buildingHeight',
  peakLoad: 'tooltips.peakLoad',
  energyDemandProfile: 'tooltips.energyDemandProfile',
  buildingUsageType: 'tooltips.buildingUsageType',
  electricityDemand: 'tooltips.electricityDemand',
  recalculateSummary: 'tooltips.recalculateSummary',
  adminLevel: 'tooltips.adminLevel'
} as const;

export type TooltipKey = keyof typeof TOOLTIP_KEYS;

// Fallback content (English) - used when translations are not available
export const TOOLTIP_CONTENTS = {
  multiplePolygons: {
    title: 'Multiple Polygons',
    description: 'Enable this option to draw multiple separate areas on the map for your Energy assessment. When disabled, drawing a new polygon will replace the previous one. When enabled, you can define multiple distinct areas that will all be included in the analysis.',
    example: 'Use this to analyze energy simulation across multiple non-contiguous areas simultaneously.'
  },
  publicBuildings: {
    title: 'Public Custom Buildings',
    description: 'Include buildings shared by other users in the grid calculation. These are custom buildings that other users have made publicly available.',
    example: 'You can also exclude individual buildings by clicking on them on the map.'
  },
  privateBuildings: {
    title: 'My Custom Buildings',
    description: 'Include your private custom buildings in the grid calculation. These are buildings you have created and saved to your account.',
    example: 'You can also exclude individual buildings by clicking on them on the map.'
  },
  simulateEV: {
    title: 'Simulate EV Hosting Capacity',
    description: 'Calculate the Electric Vehicle hosting capacity for each transformer in the selected area. This determines how many EV chargers (11 kW Level 2) can be connected before reaching grid constraints. The calculation considers transformer thermal limits, voltage drop, and cable capacity based on the deterministic method from Umoh et al. (Energies 2023).',
    example: 'A "Grid Constrained" status means the transformer is already at capacity and cannot host additional EV chargers without upgrades.'
  },
  gridConstrained: {
    title: 'Grid Constrained',
    description: 'This status indicates that the transformer has reached its hosting capacity limit and cannot support additional EV chargers. The limiting factor is typically the transformer thermal capacity (kVA), but can also be voltage drop limits (EN 50160: min 0.90 p.u.) or cable thermal limits. A simultaneity factor of 0.8 is applied, meaning 80% of chargers are assumed to operate simultaneously.',
    example: 'Upgrade the local transformer or distribute EV charging across multiple connection points to resolve grid constraints.'
  },
  buildingEnrichment: {
    title: 'Building Enrichment Data',
    description: 'This section shows enrichment data from external sources. For the Netherlands: 3D BAG, EP-Online energy labels, and CBS demographics (postcode-area statistics). For Czech Republic: CUZK LiDAR height data (DMP1G surface + DMR5G terrain) and EUBUCCO building type. For Germany and Austria: EUBUCCO building data (height, type, estimated floors).',
    example: 'Netherlands: BAG ID, energy labels, CBS population/households. Czech Republic: CUZK LiDAR building heights, EUBUCCO type. Germany/Austria: EUBUCCO height and building type. Sources vary by country.'
  },
  bagFloors: {
    title: 'Number of Floors',
    description: 'Number of above-ground storeys. Editable — changing this recalculates total floor area (= footprint × floors), which directly affects energy estimation.\n\nFor residential buildings:\n• Total area determines estimated dwelling units (units = total area ÷ reference area)\n• Buildings with ≥ 3 floors or ≥ 300 m² total area are automatically treated as multi-unit apartments\n\nFor non-residential buildings:\n• Total area is multiplied by the kWh/m² benchmark for that building type',
    example: 'An 80 m² footprint × 3 floors = 240 m² total. For apartments: 240 ÷ 120 = 2.0 units. Changing to 4 floors → 320 m² → 2.7 units.'
  },
  bagId: {
    title: 'BAG ID',
    description: 'Unique Dutch BAG building identifier (Pand ID) for this specific building object.',
    example: 'Useful for linking this building to external BAG/EP datasets.'
  },
  energyLabel: {
    title: 'Energy Label (EP-Online)',
    description: 'Official building energy performance class from EP-Online, displayed with the standard European A–G color scale. This label reflects the overall energy efficiency of the building envelope and systems, but is NOT directly used in the electricity estimation — the AI estimator uses construction year as an age proxy instead.\n\nThe label is informational and helps validate the age correction factor:\n• A/A+ → typically post-2016 (age factor ×0.90)\n• B/C → typically 2002–2015 (age factor ×0.95–1.00)\n• D/E → typically 1978–2001 (age factor ×1.04–1.11)\n• F/G → typically pre-1978 (age factor ×1.16–1.22)',
    example: 'A label B building built in 2010 would get age factor ×0.95. The label itself is not used in the formula, but confirms the building is relatively modern.'
  },
  cbsPopulation: {
    title: 'CBS Population (PC6/PC4)',
    description: 'Total population for the matched postcode area from CBS (Statistics Netherlands). PC6 is the full 6-digit Dutch postcode (e.g. 1234 AB) covering a few streets, while PC4 is the broader 4-digit area (e.g. 1234). PC6 is used when available, otherwise falls back to the larger PC4 area.',
    example: 'This is an area-level statistic, not the number of people in this single building. Source: CBS Open Data (CC BY 4.0).'
  },
  cbsHouseholds: {
    title: 'CBS Households (PC6/PC4)',
    description: 'Total private households for the matched postcode area from CBS (Statistics Netherlands). PC6 is the full 6-digit Dutch postcode (e.g. 1234 AB) covering a few streets, while PC4 is the broader 4-digit area (e.g. 1234). PC6 is used when available, otherwise falls back to the larger PC4 area.',
    example: 'This is an area-level statistic, not the number of households in this single building. Source: CBS Open Data (CC BY 4.0).'
  },
  cbsAvgHouseholdSize: {
    title: 'People in Household',
    description: 'Number of persons per dwelling unit (1–5). Editable — this directly selects the Stromspiegel 2025 electricity benchmark for residential buildings.\n\nStromspiegel 2025 annual kWh (without electric hot water):\n  Apartments: 1p→1,200  2p→1,900  3p→2,400  4p→2,600  5p→3,100\n  Houses:       1p→1,800  2p→2,700  3p→3,500  4p→3,800  5p→4,500\n\nFor apartment-type buildings, the household size is auto-inferred from unit area (total area ÷ units). For houses, your manual override is used if provided.\n\nNote: For apartment classes, auto-inference always takes priority to ensure consistency with the unit count calculation.',
    example: 'A 110 m² apartment → inferred 4 people (100–130 m² range) → 2,600 kWh/unit. Changing to 3 people → 2,400 kWh/unit.'
  },
  scenario: {
    title: 'Scenario Year',
    description: 'The target year for the energy system optimization. This determines the cost assumptions and demand projections used in the model.',
    example: '2030 represents a medium-term planning horizon.'
  },
  co2_limit: {
    title: 'CO2 Limit',
    description: 'The maximum allowed CO2 emissions for the optimized system in tonnes.',
    example: 'Lower values force the model to use more renewable energy sources.'
  },
  max_hours: {
    title: 'Max Battery Hours',
    description: 'The maximum duration that battery storage can discharge at full power.',
    example: '72 hours allows for multi-day storage capability.'
  },
  solver: {
    title: 'Optimization Solver',
    description: 'The mathematical solver used to find the optimal energy system configuration.',
    example: 'GLPK is a free solver, while Gurobi is a commercial high-performance solver.'
  },
  autarky: {
    title: 'Autarky Level',
    description: 'The degree of self-sufficiency required for the region, from 0 (no requirement) to 1 (100% self-sufficient).',
    example: '0.8 means 80% of energy must be produced locally.'
  },
  solarPotential: {
    title: 'Solar Potential Estimation',
    description: 'Estimated maximum PV capacity (kWp) based on total selected area. Formula: Total Area × 15% (usable area) × 0.2 kWp/m² (power density).',
    example: 'A 1000m² area results in approx 30 kWp of potential capacity.'
  },
  area: {
    title: 'Total Selected Area',
    description: 'The combined surface area of all selected polygons on the map. This is used as the basis for energy demand and generation potential calculations.',
    example: '1 hectare (ha) = 10,000 m².'
  },
  perimeter: {
    title: 'Total Perimeter',
    description: 'The total length of the boundary lines of all selected polygons.',
    example: 'Useful for estimating fencing or cable routing requirements around the site.'
  },
  estGeneration: {
    title: 'Estimated Annual Generation',
    description: 'Predicted annual energy production based on the solar potential. Formula: Solar Potential (kWp) × 1100 kWh/kWp (Regional Average Yield).',
    example: 'A 30 kWp system produces approx 33 MWh/year in this region.'
  },
  co2Offset: {
    title: 'Estimated CO₂ Offset',
    description: 'Potential carbon dioxide emissions avoided by using this solar energy instead of grid electricity. Formula: Est. Generation (MWh) × 0.4 tonnes CO₂/MWh.',
    example: 'Generating 100 MWh of clean energy saves approx 40 tonnes of CO₂.'
  },
  voltageStatus: {
    title: 'Voltage Status Indicators',
    description: 'Bus voltage status is determined based on the per-unit (p.u.) voltage magnitude according to EN 50160 grid standards:\n\n• Normal (Green): Voltage within 0.95 - 1.05 p.u. — Operating within optimal range\n• Warning (Amber): Voltage between 0.90-0.95 or 1.05-1.10 p.u. — Approaching limits, monitoring recommended\n• Critical (Red): Voltage below 0.90 or above 1.10 p.u. — Outside acceptable limits, grid reinforcement may be needed',
    example: 'A voltage of 0.92 p.u. shows Warning status as it is below the optimal 0.95 threshold but still within acceptable limits.'
  },
  pypsaSimulation: {
    title: 'PyPSA Simulation',
    description: 'Enable PyPSA (Python for Power System Analysis) to run advanced energy system optimization. When enabled, the model will optimize energy flows, storage dispatch, and technology sizing to minimize costs while meeting demand and grid constraints.',
    example: 'Disable this for quick grid-only analysis. Enable for full energy system optimization with detailed results.'
  },
  powerFlow: {
    title: 'Power Flow Analysis',
    description: 'Analyzes the electrical grid to calculate voltage levels and line loading for each cable and transformer. The analysis runs automatically when you draw a polygon and shows cable colors based on loading: green (normal), yellow (warning), red (overloaded).',
    example: 'Red cables indicate overloaded lines (>100% capacity). Consider adding transformers to reduce loading.'
  },
  addTransformer: {
    title: 'Add Transformer',
    description: 'Enable this mode to place a new transformer on the map by clicking. After placing, you can choose the transformer size (kVA) and then manually assign buildings to it.',
    example: 'Use this to add transformers in areas where buildings are underserved or lines are overloaded.'
  },
  assignBuildings: {
    title: 'Assign Buildings to Transformer',
    description: 'Reassign buildings to a different transformer. First select the buildings you want to move, then click on the destination transformer. This is useful for load balancing or fixing overloaded transformers.',
    example: 'Select overloaded buildings (red cables) and assign them to a nearby transformer with spare capacity.'
  },
  buildingType: {
    title: 'Building Type (f_class)',
    description: 'The building classification from OpenStreetMap (OSM), mapped to a pylovo f_class. This is the primary driver for energy estimation — each f_class has its own research-backed electricity benchmark (kWh/m²/year) and full load hours.\n\nResidential classes (house, apartments, terrace, dormitory, …) use the Stromspiegel 2025 household method — demand is based on household size and number of dwelling units.\n\nNon-residential classes (office, school, supermarket, hospital, …) use area-based benchmarks from BDEW, AMEV 2019, EHI 2024, and CIBSE TM46.',
    example: 'Examples: "house" → 25 kWh/m², "apartments" → 20 kWh/m², "office" → 35 kWh/m², "supermarket" → 200 kWh/m², "hospital" → 100 kWh/m². Mixed-use buildings get separate demand entries per f_class.'
  },
  constructionYear: {
    title: 'Construction Year',
    description: 'Year the building was originally constructed, sourced from EUBUCCO, 3D BAG (Netherlands), or OpenStreetMap. Used to apply age-dependent electricity correction factors (EnEV 2002 baseline = 1.0).\n\nResidential age multipliers (Stromspiegel 2025 / DENA):\n• Before 1945: ×1.22 (oldest appliance stock)\n• 1945–1978: ×1.16\n• 1979–1994: ×1.08–1.11\n• 1995–2001: ×1.04\n• 2002–2009: ×1.00 (baseline)\n• 2010–2015: ×0.95\n• 2016+: ×0.90 (LED + Ecodesign appliances)\n\nNon-residential multipliers follow a similar but tighter range (×1.18 to ×0.92).',
    example: 'A 1970 apartment building gets ×1.16, so 3,100 kWh base → 3,596 kWh/yr. A 2020 building gets ×0.90 → 2,790 kWh/yr.'
  },
  floorArea: {
    title: 'External Floor Area (per floor)',
    description: 'The ground-floor footprint area of the building polygon, calculated from map geometry. The total floor area used for estimation = this value × number of floors.\n\nFor residential buildings (household method):\n• Total area determines the number of dwelling units: units ≈ total area ÷ reference area per unit\n• Reference areas by household size: 1p → 45 m², 2p → 65 m², 3p → 80 m², 4p → 100 m², 5p → 120 m²\n\nFor non-residential buildings (area method):\n• Yearly demand = total area × specific benchmark (kWh/m²) × age factor',
    example: 'A 3-floor building with 80 m²/floor = 240 m² total. For apartments with 4 people/unit: 240 ÷ 100 = 2.4 units → yearly ≈ 2,600 × 2.4 = 6,240 kWh.'
  },
  buildingHeight: {
    title: 'Building Height',
    description: 'Building height data sourced per country: 3D BAG LiDAR (Netherlands), CUZK LiDAR (Czech Republic), or EUBUCCO (Germany, Austria, and others). Three measurements may be provided:\n\n• Height Ground: elevation of the ground surface at the building footprint (meters above reference)\n• Height Median: median roof height — the typical roof surface level, useful for estimating usable floor height\n• Height Max: highest point of the building including roof ridge, chimneys, or antennas\n\nThe difference (Max − Ground) gives the total building height. Combined with floor count, this helps validate the number of storeys.',
    example: 'Ground: 2.0 m, Median: 8.4 m, Max: 11.5 m → total height ≈ 9.5 m. With 3 floors, that is ~3.2 m per storey (typical for residential).'
  },
  peakLoad: {
    title: 'Peak Electrical Load (kW)',
    description: 'Maximum expected 15-minute electrical power demand, used for grid/cable sizing.\n\nResidential (household method):\n  Peak = base_peak × household_factor × N_units × g(N) × age_factor\n  • base_peak = 14.5 kW (DIN 18015-1:2020 planning value per dwelling)\n  • household_factor: 1p → 0.80, 2p → 1.00, 3p → 1.10, 4p → 1.20, 5p → 1.30\n  • g(N) = N⁻⁰·⁴⁵ (DIN 18015-1 coincidence/diversity factor)\n\nNon-residential (area method):\n  Peak = area × W/m² benchmark × age_factor ÷ 1000\n  • Benchmarks: office 20 W/m², supermarket 50 W/m², hospital 65 W/m², restaurant 80 W/m²\n  • Fallback: yearly_kWh ÷ full_load_hours',
    example: 'Apartments, 2 units, 4 people: 14.5 × 1.20 × 2 × 2⁻⁰·⁴⁵ = 25.5 kW. Single house, 3 people: 14.5 × 1.10 × 1 × 1.0 = 16.0 kW.'
  },
  energyDemandProfile: {
    title: 'Energy Demand Profile',
    description: 'Annual electricity consumption for this building (kWh/year). Covers appliances, lighting, HVAC auxiliary, and cooking — does NOT include space heating or hot water.\n\nEstimated by the pylovo AI estimator using:\n1. Building type (f_class) → selects estimation method\n2. Total floor area (footprint × floors) → scales demand\n3. Household size (residential only) → Stromspiegel 2025 lookup\n4. Construction year → age correction factor\n\nYou can manually override these values. For mixed-use buildings, each f_class gets its own editable demand entry.',
    example: 'Sources: Stromspiegel 2025 (co2online, n=57,000 bills), BDEW profiles, EHI 2024, AMEV 2019, CIBSE TM46.'
  },
  buildingUsageType: {
    title: 'Building Usage Type',
    description: 'Functional classification derived from OpenStreetMap building tags, mapped to pylovo f_class categories. Each f_class has specific electricity benchmarks:\n\nResidential: house, apartments, terrace, dormitory, bungalow, farmhouse\nCommercial: office, retail, shop, supermarket, hotel, restaurant, cafe\nPublic: school, hospital, university, church, museum, sports_centre\nIndustrial: factory, warehouse, workshop, cold_storage\nAgricultural: farm, barn, greenhouse, stable\nInfrastructure: train_station, airport, parking, data_center',
    example: 'A building tagged "apartments" + "retail" gets two demand entries: one using the residential household method, another using the retail area benchmark (71 kWh/m²).'
  },
  electricityDemand: {
    title: 'Annual Electricity Demand (kWh/yr)',
    description: 'Total annual electricity for the entire building (all floors combined).\n\nResidential formula (household method):\n  Demand = kWh_per_unit × number_of_units × age_factor\n  • kWh_per_unit from Stromspiegel 2025 by household size:\n    Apartments: 1p→1,200  2p→1,900  3p→2,400  4p→2,600  5p→3,100\n    Houses:     1p→1,800  2p→2,700  3p→3,500  4p→3,800  5p→4,500\n  • number_of_units = total_area ÷ reference_area\n\nNon-residential formula (area method):\n  Demand = total_area × kWh/m² benchmark × age_factor\n  • Example benchmarks: office 35, school 18, hospital 100, supermarket 200',
    example: 'Apartments, 240 m², 4 people/unit: units = 240÷100 = 2.4 → demand = 2,600 × 2.4 = 6,240 kWh/yr. Office 500 m²: 500 × 35 = 17,500 kWh/yr.'
  },
  recalculateSummary: {
    title: 'Recalculation Summary',
    description: 'Parameters sent to the AI energy estimator when you click "Recalculate Demand":\n\n• Total floor area = external footprint × number of floors\n• Household size = people per dwelling unit (residential only)\n• Number of units = total area ÷ reference area for that household size\n• Building type (f_class) → determines estimation method\n• Construction year → age correction multiplier\n\nThe estimator returns updated yearly demand (kWh) and peak load (kW). Changing floors, area, or household size and clicking recalculate will update the energy values.',
    example: '"Total: 240 m² (3 fl. × 80 m²), 5 people/unit, ~2.0 units" means: 3 floors × 80 m² footprint = 240 m² total area, 5-person household benchmark, area fits ~2 dwelling units (240 ÷ 120 ref).'
  },
  adminLevel: {
    title: 'OSM Admin Level',
    description: 'OpenStreetMap administrative boundary level used when fetching region data.\n\n• Level 2 — Country (e.g., Germany, Netherlands)\n• Level 4 — State / Province (e.g., Bremen, Noord-Holland)\n• Level 6 — District / County (Landkreis)\n• Level 8 — Municipality / City\n\nThe data pipeline downloads building and grid data at the state level (Level 4) by default.',
    example: 'Bremen is admin level 4 (state). Hamburg is also level 4. Berlin Mitte would be level 8 (municipality).'
  }
} as const;
