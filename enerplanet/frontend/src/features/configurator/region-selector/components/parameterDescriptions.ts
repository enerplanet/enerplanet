/**
 * Descriptions for all technology parameters shown in the info icon tooltip.
 * Covers: Battery, PV, Wind, Biomass, Geothermal, Hydropower, and Consumer technologies.
 */

// ── General parameter descriptions (shown in the info icon tooltip) ──────────

export const staticDescriptions: Record<string, string> = {
    // ── General / Shared ─────────────────────────────────────────────
    cont_energy_cap_max:
        "The maximum amount of power (in kilowatts) this technology is allowed to produce at this location. " +
        "Think of it as the size limit for the installation — for example, a 1,200 kW cap means the system can never output more than 1,200 kW at any moment. " +
        "Increase this value if you want to allow a larger installation, or decrease it to restrict the system size.",

    cont_energy_cap_max_systemwide:
        "An overall cap on the total installed capacity of this technology across ALL locations combined. " +
        "For example, if set to 10,000 kW, the optimizer will not install more than 10 MW of this technology across the entire region, even if individual sites could support more. " +
        "Set to Infinity (∞) if you do not want a system-wide limit.",

    cont_energy_cap_min:
        "The minimum capacity that must be installed if this technology is chosen for a location. " +
        "Set to 0 if the technology is optional (the optimizer can choose not to install it). " +
        "Set to a positive value to force a minimum installation size — useful when equipment comes in fixed minimum sizes.",

    cont_energy_cap_scale:
        "A multiplier applied to the energy capacity. At 1.0 (100%), the full rated capacity is used. " +
        "Values below 1.0 derate the system — for example, 0.8 means only 80% of the nameplate capacity is considered available. " +
        "Useful for accounting for site-specific limitations like partial shading or restricted grid connection.",

    cont_energy_eff:
        "How efficiently this technology converts its primary energy source into electricity. " +
        "A value of 0.9 (90%) means 10% of the input energy is lost during conversion. " +
        "For batteries, this is the round-trip efficiency (charge + discharge). For solar panels, this is already built into the module type. " +
        "For biomass and geothermal, this reflects the thermodynamic cycle efficiency.",

    cont_export_cap:
        "The maximum power this technology can feed back into the electricity grid. " +
        "Set to Infinity (∞) to allow unlimited export. Set to 0 to prevent any grid export (self-consumption only). " +
        "In Germany, grid operators may limit feed-in capacity — check your local grid connection agreement for the allowed value.",

    cont_lifetime:
        "How many years the technology is expected to operate before it needs to be replaced. " +
        "This affects the economic calculation — longer lifetimes spread the investment cost over more years, reducing the annual cost. " +
        "Typical values: Solar panels 25–30 years, wind turbines 20–25 years, batteries 10–15 years, biomass plants 20–30 years, geothermal 30–50 years.",

    cont_parasitic_eff:
        "The fraction of generated electricity that is available after subtracting the plant's own internal consumption. " +
        "Every power plant uses some electricity to run its own equipment (pumps, fans, control systems). " +
        "A value of 1.0 means no internal consumption (ideal). A value of 0.93 means 7% of the generated power is consumed internally. " +
        "For PV systems this is typically 1.0 (parasitic losses are negligible). For biomass or geothermal plants, values of 0.90–0.95 are common.",

    cont_resource_eff:
        "How efficiently the incoming energy resource is delivered to the end user. " +
        "For consumer/demand technologies, this accounts for distribution losses between the grid connection and the point of use. " +
        "A value of 1.0 means no distribution losses. Typically set to 1.0 unless you want to model local wiring or transformer losses.",

    // ── Storage (Battery) ────────────────────────────────────────────
    cont_storage_cap_max:
        "The maximum amount of energy (in kWh) the battery can store. This determines how long the battery can supply power. " +
        "For example, an 8,000 kWh battery at 1,000 kW discharge rate can run for 8 hours. " +
        "Larger storage allows more energy shifting (storing cheap daytime solar for expensive evening demand) but increases cost.",

    cont_storage_cap_min:
        "The minimum storage capacity that must be installed if battery storage is selected for this location. " +
        "Set to 0 to make the storage size fully flexible. Set to a positive value if your battery supplier has a minimum order size.",

    cont_storage_discharge_depth:
        "How deeply the battery is allowed to discharge. This protects battery health and extends its lifetime. " +
        "A value of 0 means the battery can be fully emptied (0% state of charge). " +
        "A value of 0.2 means the battery always keeps at least 20% charge — it will stop discharging at 20%. " +
        "Lithium-ion batteries typically allow 80–90% depth of discharge (set to 0.1–0.2).",

    cont_storage_initial:
        "How full the battery is at the very start of the simulation. " +
        "0 = completely empty, 0.5 = half charged, 1.0 = fully charged. " +
        "This mainly affects the first few hours of simulation results. Set to 0 for a conservative assumption.",

    cont_storage_loss:
        "How much stored energy the battery loses each hour just by sitting idle (self-discharge). " +
        "Modern lithium-ion batteries have very low self-discharge (0.001–0.005 per hour, i.e., 0.1–0.5% per hour). " +
        "Set to 0 if self-discharge is negligible for your simulation timeframe.",

    // ── PV Parameters ────────────────────────────────────────────────
    system_capacity:
        "The total peak DC power output of all solar panels combined, measured under Standard Test Conditions (STC: 1,000 W/m² sunlight, 25°C cell temperature). " +
        "This is the number you see on the panel datasheet — e.g., a rooftop with 20 panels × 400 W each = 8 kWdc. " +
        "The actual output will be lower due to temperature, shading, inverter losses, and less-than-ideal sunlight conditions.",

    module_type:
        "The type of solar cell technology used in the PV panels. This determines the panel efficiency, how well it performs in heat, and its cost per watt.",

    inverter_type:
        "The type of inverter that converts the DC electricity from the solar panels into AC electricity for the grid. " +
        "Note: Power optimizers are DC-DC converters (not inverters) — they still require a separate inverter and are not listed here.",

    optimize_orientation:
        "When turned ON, the system automatically calculates the best tilt angle and compass direction for your solar panels based on the building's geographic location. " +
        "It uses the sun's position throughout the year (summer solstice, winter solstice, and annual average) to determine the angles that maximize energy production. " +
        "When ON, the manual Tilt and Azimuth values below are ignored and replaced with the calculated optimal values. " +
        "Turn OFF if you want to set specific angles manually — for example, if your roof has a fixed pitch or orientation that cannot be changed.",

    azimuth:
        "The compass direction your solar panels face, measured in degrees clockwise from North. " +
        "0° = panels face North, 90° = panels face East (catches morning sun), 180° = panels face South (maximum total energy in the Northern Hemisphere), 270° = panels face West (catches afternoon/evening sun). " +
        "For Germany and Central Europe, 180° (due South) produces the most annual energy. " +
        "East or West orientations produce about 15–20% less total energy but can better match morning or evening demand peaks.",

    tilt:
        "The angle of the solar panels measured from the horizontal ground. " +
        "0° = panels are flat on the ground/roof (horizontal), 90° = panels are mounted vertically like a wall. " +
        "For Germany (latitude 48–54°), the optimal year-round tilt is about 30–40°. " +
        "A lower tilt (15–25°) captures more energy in summer when the sun is high. A steeper tilt (40–55°) captures more in winter when the sun is low, and also helps snow slide off. " +
        "For flat roofs, 10–15° is common to minimize wind loads. For pitched roofs, use the actual roof angle.",

    inv_eff:
        "How efficiently the inverter converts DC power from the panels into AC power for the grid. " +
        "A value of 0.96 means 96% of the DC power becomes usable AC power, and 4% is lost as heat in the inverter. " +
        "This value is automatically set when you choose an Inverter Type above. " +
        "Higher efficiency means more usable electricity from the same panels. Modern inverters range from 95% to 98%.",

    losses:
        "The total percentage of energy lost between the panels and the grid connection point, from all causes combined. " +
        "This includes: soiling/dust on panels (~2%), electrical wiring losses (~2%), panel mismatch (~2%), shading (~3%), " +
        "snow/ice (~1%), aging degradation (~1.5%), and other minor losses. " +
        "The default of 14% is a realistic estimate for a well-designed European installation. " +
        "Reduce this for optimal installations with no shading. Increase it for older systems or sites with frequent dust/snow.",

    dc_ac_ratio:
        "The ratio between the DC panel capacity and the AC inverter capacity. " +
        "A ratio of 1.1 means you have 10% more panel capacity than the inverter can handle at peak. " +
        "This is intentional — on most hours the panels produce well below peak, so the oversized array captures more energy during cloudy or early/late hours. " +
        "On the rare sunny peak hours, the inverter 'clips' the excess (wastes a small amount). " +
        "Values of 1.1–1.3 are common. Higher ratios are more cost-effective in cloudy climates like Germany.",

    // ── Wind Parameters ──────────────────────────────────────────────
    turbine_id:
        "Select a specific wind turbine model from the database of 107 commercially available turbines. " +
        "When you choose a turbine, its rated power, available hub heights, and rotor diameter are automatically filled in. " +
        "Each turbine has a unique power curve that determines how much electricity it produces at different wind speeds.",

    nominal_power:
        "The maximum power output of the wind turbine, achieved when wind speed reaches the turbine's rated speed (typically 12–15 m/s). " +
        "This value is set automatically when you select a turbine model and cannot be changed independently. " +
        "At lower wind speeds the turbine produces proportionally less power according to its power curve.",

    hub_height:
        "The height of the center of the turbine rotor above the ground. " +
        "Wind speed increases with height because there is less friction from the ground surface (trees, buildings). " +
        "A turbine at 120 m hub height will typically produce 10–20% more energy than the same turbine at 80 m, " +
        "but taller towers cost significantly more and may face stricter planning permission requirements. " +
        "Available heights depend on the selected turbine model.",

    rotor_diameter:
        "The diameter of the circle swept by the turbine blades as they rotate. " +
        "Larger rotors capture wind from a bigger area, producing more energy — especially at lower wind speeds. " +
        "A 100 m rotor sweeps about 7,850 m² of air. A 150 m rotor sweeps 17,670 m² — more than double. " +
        "This value is set automatically when you select a turbine model.",

    // ── Biomass Parameters ───────────────────────────────────────────
    feedstock_per_year:
        "The total weight of biomass fuel consumed by the plant each year, measured in metric tons. " +
        "This must be enough to keep the plant running at its designed output. " +
        "For a 5 MW plant at 34% efficiency using forest residue, roughly 25,000–35,000 tons/year are needed. " +
        "Consider local feedstock availability and transport distance when setting this value.",

    boiler_efficiency:
        "The overall efficiency of converting the chemical energy in the biomass feedstock into electricity. " +
        "A value of 0.34 means 34% of the energy content in the fuel becomes electricity — the rest is lost as waste heat. " +
        "Small biomass plants: 20–28%. Medium plants with modern steam cycles: 28–35%. " +
        "Combined heat and power (CHP) plants can reach much higher total efficiency (70–85%) when waste heat is also used.",

    total_hhv:
        "The Higher Heating Value — the total energy content of the fuel per unit weight, measured in BTU per pound. " +
        "This includes the energy released when water vapor in the combustion gases condenses back to liquid (latent heat). " +
        "Dry wood and forest residue: ~7,500–8,500 Btu/lb. Agricultural residues (straw, stover): ~6,000–7,500 Btu/lb. " +
        "Wet fuels have lower effective HHV because energy is spent evaporating moisture.",

    steam_grade_psig:
        "The pressure of the superheated steam entering the turbine, measured in pounds per square inch gauge (psig). " +
        "Higher steam pressure means more energy can be extracted per unit of steam, improving efficiency. " +
        "Typical small biomass plants: 600–900 psig. Larger modern plants: 900–1,500 psig. " +
        "Higher pressures require more expensive boiler materials (thicker walls, special alloys) and stricter safety inspections.",

    boiler_numbers:
        "How many separate boiler units the plant has. " +
        "Multiple boilers provide flexibility — you can run just one boiler at low demand and add more when demand increases. " +
        "This also allows maintenance on one boiler while the others keep running. " +
        "Single boiler: simpler, lower cost. Two or more: better reliability and load flexibility.",

    flue_gas_temperature:
        "The temperature of the exhaust gases as they leave the boiler and enter the chimney, measured in °F. " +
        "Lower exit temperatures mean more heat was extracted from the fuel (better efficiency). " +
        "However, if the temperature drops too low (below ~250°F), acidic compounds in the gas can condense and corrode the chimney. " +
        "Typical range: 250–450°F. The default of 300°F is a good balance between efficiency and equipment protection.",

    parasitic_load:
        "The percentage of the plant's own electricity output that is consumed by its internal equipment. " +
        "This includes fuel conveyors, fans, water pumps, pollution control equipment, lighting, and control systems. " +
        "A 5 MW plant with 7% parasitic load actually delivers 4.65 MW to the grid. " +
        "Typical biomass plants: 5–10%. Plants with extensive flue gas cleaning may reach 10–15%.",

    combustor_type:
        "The type of furnace used to burn the biomass fuel. Each design has different strengths for different fuel types and plant sizes.",

    feedstock_type:
        "The type of biomass material used as fuel. " +
        "Each feedstock has different chemical composition, moisture content, and heating value, which affect how the plant is designed and operated.",

    // ── Geothermal Parameters ────────────────────────────────────────
    num_wells:
        "The total number of wells drilled for the geothermal system — including both production wells (bringing hot fluid to the surface) and injection wells (returning cooled fluid underground). " +
        "A typical doublet system has 1 production + 1 injection well. Larger plants may have multiple doublets. " +
        "More wells increase output capacity but each well costs several million euros to drill.",

    plant_efficiency_input:
        "How efficiently the plant converts geothermal heat into electricity. " +
        "A value of 0.15 (15%) means for every 100 kW of thermal energy extracted from underground, 15 kW becomes electricity. " +
        "Binary cycle plants (used in Central Europe, 100–180°C): 10–15%. Flash steam plants (>180°C): 15–25%. " +
        "Lower resource temperatures result in lower efficiency due to thermodynamic limits.",

    resource_depth:
        "How deep underground the geothermal reservoir is located, in meters. " +
        "Deeper reservoirs are hotter (temperature increases about 25–35°C per kilometer in Central Europe), producing more energy. " +
        "However, deeper wells are much more expensive to drill — costs increase roughly exponentially with depth. " +
        "Typical Central European deep geothermal: 3,000–5,000 m, reaching temperatures of 100–170°C.",

    specified_pump_work_amount:
        "The electrical power (in megawatts) needed to pump the geothermal fluid through the system. " +
        "This includes the downhole pump in the production well and any surface booster pumps. " +
        "Pump power is a parasitic load — it reduces the net electrical output of the plant. " +
        "Typical values: 0.1–0.5 MW for a standard doublet. Higher for deep wells or low-permeability reservoirs.",

    well_flow_rate:
        "How much geothermal fluid each production well delivers to the surface, measured in kilograms per second. " +
        "Higher flow rates mean more thermal energy is available for electricity generation. " +
        "However, very high extraction rates can cause reservoir pressure to drop over time (drawdown), reducing long-term output. " +
        "Typical European deep geothermal: 50–120 kg/s per well. Highly productive reservoirs in the Munich area: up to 150 kg/s.",

    pump_efficiency:
        "How efficiently the geothermal circulation pumps convert electrical energy into fluid flow. " +
        "A value of 0.65 (65%) means 35% of the pump's electrical input is lost as heat and friction. " +
        "Better pumps (0.75–0.85) reduce the parasitic electrical load on the plant. " +
        "Typical range: 0.55–0.85 depending on pump type, depth, and fluid temperature.",

    // ── Cost Parameters (shared across technologies) ─────────────────
    cost_energy_cap:
        "The total investment cost per kilowatt of installed capacity. This is the 'all-in' cost including the equipment itself, " +
        "installation labor, grid connection, and project development costs. " +
        "Examples (Germany, 2024): Solar PV 800–1,200 EUR/kW, Onshore wind 1,100–1,500 EUR/kW, " +
        "Battery storage 800–1,200 EUR/kW, Biomass 2,500–4,000 EUR/kW, Geothermal 3,000–6,000 EUR/kW.",

    cost_export:
        "The cost or revenue per kWh of electricity exported (sold) to the grid. " +
        "A positive value means you pay to export (rare). A value of 0 means no payment for exported electricity. " +
        "In Germany, feed-in tariffs or market premiums may apply — check current EEG rates for your technology and size.",

    cost_interest_rate:
        "The annual interest rate used to calculate the cost of financing the investment, also called the discount rate or WACC. " +
        "A value of 0.02 (2%) is typical for low-risk renewable energy projects in Germany with favorable loan conditions. " +
        "Higher rates (4–8%) apply for riskier projects or when financed with more equity. " +
        "This significantly affects the annualized cost — higher rates make capital-intensive technologies like geothermal relatively more expensive.",

    cost_om_annual:
        "Fixed yearly operation and maintenance cost per kilowatt of installed capacity, paid regardless of how much energy is produced. " +
        "Covers regular inspections, spare parts, insurance, land lease, and administrative costs. " +
        "Examples: Solar PV 8–15 EUR/kW/year, Wind 20–40 EUR/kW/year, Biomass 30–60 EUR/kW/year.",

    cost_om_annual_investment_fraction:
        "An alternative way to express annual O&M costs — as a percentage of the initial investment cost. " +
        "For example, 0.02 (2%) on a 1,000 EUR/kW investment means 20 EUR/kW/year in O&M. " +
        "Use either this OR the fixed EUR/kW value above, not both. Set to 0 if you use the fixed cost instead.",

    cost_om_con:
        "The price paid per kilowatt-hour of electricity consumed (purchased from the grid). " +
        "For household consumers in Germany (2024): approximately 0.35–0.42 EUR/kWh including taxes and levies. " +
        "For commercial/industrial consumers: approximately 0.20–0.30 EUR/kWh depending on consumption volume.",

    cost_om_prod:
        "Variable cost per kilowatt-hour of electricity produced. This includes fuel costs, consumable materials, and any output-dependent maintenance. " +
        "For solar and wind this is typically 0 (no fuel). For biomass, this covers the feedstock purchase and handling cost per kWh produced.",

    cost_purchase:
        "A one-time fixed cost for purchasing and installing the technology, independent of the capacity size. " +
        "This covers fixed project costs like permits, grid connection studies, and project management. " +
        "Set to 0 if all costs are already captured in the per-kW cost above.",

    cost_storage_cap:
        "The investment cost per kilowatt-hour of battery storage capacity. " +
        "This is separate from the power capacity cost (EUR/kW) — storage cost depends on how many hours of storage you need. " +
        "Lithium-ion batteries (2024): approximately 300–500 EUR/kWh for utility-scale, 700–1,200 EUR/kWh for residential systems.",
};

// ── Per-option descriptions for dropdown parameters ──────────────────────────
// Shown in the info icon tooltip, listed under each option name.

export const optionDescriptions: Record<string, Record<string, string>> = {
    optimize_orientation: {
        "Off (use manual values)":
            "Use the Tilt and Azimuth values you set manually below. Choose this when your roof has a fixed angle that cannot be changed.",
        "On (calculate optimal for location)":
            "Automatically calculate the best tilt and azimuth based on the building's latitude and longitude using solar position analysis. Overrides manual Tilt and Azimuth values.",
    },
    module_type: {
        "Standard Crystalline Silicon (19%)":
            "The most widely used solar cell technology worldwide. Made from mono or polycrystalline silicon wafers. " +
            "Offers the best balance of efficiency, durability, and cost. 19% efficiency means a 1 m² panel produces about 190 W peak. " +
            "Expected lifespan: 25–30 years with less than 0.5% degradation per year.",
        "Premium Crystalline Silicon (21%)":
            "High-efficiency monocrystalline cells using advanced architectures like IBC (Interdigitated Back Contact) or HJT (Heterojunction). " +
            "Produces about 10% more power per square meter compared to standard panels. " +
            "Best choice when roof space is limited and you want maximum output. Higher cost per panel but lower cost per kWh over lifetime.",
        "Thin Film (18%)":
            "Made by depositing thin semiconductor layers (CdTe or CIGS) on glass or flexible substrates. " +
            "Lighter weight than crystalline panels, performs better in high temperatures and low-light conditions (cloudy weather, dawn/dusk). " +
            "Lower cost per square meter but also slightly lower efficiency, so you need more area for the same output.",
    },
    inverter_type: {
        "String Inverter (96%)":
            "One inverter connects to a 'string' of panels wired in series. The most common and cost-effective option for residential and small commercial systems. " +
            "Limitation: if one panel in the string is shaded or underperforming, it reduces the output of the entire string.",
        "Microinverter (96.5%)":
            "A small inverter is attached to each individual panel, converting DC to AC right at the panel. " +
            "Each panel operates independently — shading on one panel does not affect the others. " +
            "Also provides per-panel monitoring. Slightly higher cost but ideal for roofs with partial shading, multiple orientations, or complex layouts.",
        "Central Inverter (97%)":
            "A single large inverter handles the entire PV array. Used in commercial rooftops and utility-scale solar farms (100 kW and above). " +
            "Highest efficiency at scale and lowest cost per watt for large installations. " +
            "Not suitable for small residential systems or locations with significant shading differences between panels.",
    },
    combustor_type: {
        "Grate Stoker Furnace":
            "The biomass fuel is fed onto a moving or fixed metal grate where it burns. Air is supplied from below and above. " +
            "This is the most proven and widely used technology for wood chips, bark, and forest residue. " +
            "Handles fuels with up to 60% moisture content. Simple operation and lower capital cost. Best for plants up to 20 MW.",
        "Fluidized Bed Combustor":
            "The fuel is burned in a bed of hot sand particles kept suspended ('fluidized') by upward-flowing air. " +
            "The intense mixing ensures very uniform combustion temperatures, which reduces harmful emissions (NOx, SO2). " +
            "Excellent fuel flexibility — can handle mixed feedstocks, agricultural waste, and low-quality fuels that would clog a grate furnace. " +
            "Higher capital cost but better for plants that need to burn diverse or difficult fuels.",
        "Cyclone Furnace":
            "Fuel and air are injected tangentially into a cylindrical chamber, creating a high-temperature vortex. " +
            "Achieves very high heat release rates in a compact space. " +
            "Works best with finely ground, dry fuels. Less common in biomass but used in some large-scale installations. " +
            "Higher operating temperatures can increase NOx emissions compared to fluidized bed systems.",
    },
    feedstock_type: {
        "forest":
            "Forest residue — branches, treetops, bark, and thinning material from forestry operations. " +
            "The most common biomass fuel in Germany and Central Europe. HHV ≈ 7,700 Btu/lb. Moderate moisture (30–50%). " +
            "Widely available, sustainable when sourced from certified forestry management.",
        "woody":
            "Short-rotation woody crops — fast-growing trees like willow, poplar, or eucalyptus planted specifically as energy crops. " +
            "Harvested every 2–5 years. HHV ≈ 7,600 Btu/lb. Can be grown on marginal agricultural land. " +
            "Provides a reliable, controlled supply of biomass but requires dedicated land.",
        "mill":
            "Sawmill and wood processing residue — sawdust, wood shavings, bark, and offcuts from timber industry. " +
            "Low moisture (10–25%), consistent particle size and quality. Often the cheapest biomass fuel because it is a waste product. " +
            "Supply depends on the local timber processing industry.",
        "urban":
            "Urban wood waste — lumber from construction/demolition, used pallets, packaging wood, and yard trimmings. " +
            "Variable quality and may contain nails, paint, or preservative chemicals that require additional emission controls. " +
            "Often available at low or negative cost (waste disposal fees). Requires careful sorting and quality control.",
        "stover":
            "Corn stover — the stalks, leaves, husks, and cobs left in the field after corn grain harvest. " +
            "HHV ≈ 6,800 Btu/lb. Seasonally available (autumn harvest). High silica and alkali content can cause boiler slagging and fouling. " +
            "Abundant in corn-growing regions but removing too much stover from fields can reduce soil quality.",
        "wheat":
            "Wheat straw — the stems and chaff remaining after wheat grain is harvested. " +
            "Lower density than wood — needs baling and may require preprocessing (pelletizing) for efficient transport and combustion. " +
            "High alkali content (potassium) can cause slagging in the boiler. Common agricultural residue in European grain regions.",
        "barley":
            "Barley straw — similar characteristics to wheat straw. Available as an agricultural byproduct across Central European grain-growing regions. " +
            "Can be co-fired with wood to reduce slagging issues. Lower heating value than wood-based fuels.",
        "rice":
            "Rice straw and rice husks — byproducts of rice production. Very high silica content (15–20%) requires special ash handling equipment. " +
            "Ash can damage boiler surfaces through erosion and slagging. Most commonly used in Asian biomass plants. " +
            "Limited relevance for Central European installations.",
        "bagasse":
            "Sugarcane bagasse — the fibrous material left after sugarcane is crushed to extract juice. " +
            "High moisture content (45–55%) but freely available at sugar mills, often at zero fuel cost. " +
            "Primarily relevant for tropical and subtropical regions. Not available in Central Europe.",
        "herb":
            "Herbaceous energy crops — perennial grasses like miscanthus (elephant grass) or switchgrass, grown specifically for energy use. " +
            "Very high yield per hectare (15–25 tons/ha/year for miscanthus). Low input costs once established — no annual replanting needed. " +
            "Harvested annually in late winter when moisture is lowest. Can be pelletized for year-round use.",
    },
};

// ── Inverter type index → inverter efficiency mapping ────────────────────────
// Used to auto-set inv_eff when the user selects an inverter type.

export const inverterTypeEfficiency: Record<number, number> = {
    0: 0.96,   // String Inverter
    1: 0.965,  // Microinverter
    2: 0.97,   // Central Inverter
};
