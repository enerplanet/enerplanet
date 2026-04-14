/**
 * Color configuration for map features and building classifications
 * Matches the color scheme from the original enerplanet Angular version
 */

export const ColorConfig = {
    // Theme colors
    theme_color: 'rgba(20, 20, 200, 0.8)',
    
    // Transformer/Power Grid - Teal
    transformer_supply_background: 'rgba(0, 150, 136, 0.8)',
    transformer_supply_border: '#009688',
    power_grid_supply_background: 'rgba(0, 150, 136, 0.8)',
    power_grid_supply_border: '#009688',
    
    // Dynamic f_class demand palette uses hashed cluster colors in mapStyleUtils.
    // Keep only explicit special classes.
    zd_demand_background: 'rgba(255, 235, 59, 0.8)',
    zd_demand_border: '#FFEB3B',
    cd_demand_background: 'rgba(255, 193, 7, 0.8)',
    cd_demand_border: '#FFC107',
    
    // Renewable Energy
    sp_supply_background: 'rgba(255, 193, 7, 0.8)',     // Solar - Amber
    sp_supply_border: '#FFC107',
    wf_supply_background: 'rgba(34, 197, 94, 0.8)',     // Wind - Green
    wf_supply_border: '#22C55E',
    pv_supply_background: 'rgba(255, 152, 0, 0.8)',     // PV - Orange
    pv_supply_border: '#FF9800',
    wind_supply_background: 'rgba(34, 197, 94, 0.8)',   // Wind - Green
    wind_supply_border: '#22C55E',
    
    // Storage
    battery_storage_background: 'rgba(103, 58, 183, 0.8)', // Deep Purple
    battery_storage_border: '#673AB7',
    
    // Other
    deactivated: 'rgba(158, 158, 158, 0.8)',
    capacity_default: 'rgba(158, 158, 158, 0.8)',
    
    // Power Network Lines
    power_line_high_voltage: 'rgba(220, 38, 38, 0.9)',      // Red - High voltage
    power_line_medium_voltage: 'rgba(234, 88, 12, 0.9)',   // Orange - Medium voltage
    power_line_low_voltage: 'rgba(37, 99, 235, 0.9)',      // Blue - Low voltage
    power_line_default: 'rgba(37, 99, 235, 0.9)',          // Blue - Default
    
    // Cluster colors for transformer networks (20 distinct colors for scalability)
    cluster_colors: [
        'rgba(59, 130, 246, 0.9)',   // Blue
        'rgba(16, 185, 129, 0.9)',   // Emerald
        'rgba(245, 158, 11, 0.9)',   // Amber
        'rgba(239, 68, 68, 0.9)',    // Red
        'rgba(139, 92, 246, 0.9)',   // Violet
        'rgba(236, 72, 153, 0.9)',   // Pink
        'rgba(6, 182, 212, 0.9)',    // Cyan
        'rgba(132, 204, 22, 0.9)',   // Lime
        'rgba(251, 146, 60, 0.9)',   // Orange
        'rgba(168, 85, 247, 0.9)',   // Purple
        'rgba(20, 184, 166, 0.9)',   // Teal
        'rgba(234, 179, 8, 0.9)',    // Yellow
        'rgba(249, 115, 22, 0.9)',   // Deep Orange
        'rgba(99, 102, 241, 0.9)',   // Indigo
        'rgba(244, 63, 94, 0.9)',    // Rose
        'rgba(34, 197, 94, 0.9)',    // Green
        'rgba(14, 165, 233, 0.9)',   // Sky
        'rgba(217, 70, 239, 0.9)',   // Fuchsia
        'rgba(161, 98, 7, 0.9)',     // Warm Brown
        'rgba(71, 85, 105, 0.9)',    // Slate
    ] as readonly string[],
    
    // Capacity factor colors (for line usage visualization)
    capacity_factor_100: 'rgba(255, 0, 0, 1)',
    capacity_factor_90: 'rgba(255, 51, 0, 1)',
    capacity_factor_80: 'rgba(255, 102, 0, 1)',
    capacity_factor_70: 'rgba(255, 153, 0, 1)',
    capacity_factor_60: 'rgba(255, 204, 0, 1)',
    capacity_factor_50: 'rgba(255, 255, 0, 1)',
    capacity_factor_40: 'rgba(204, 255, 0, 1)',
    capacity_factor_30: 'rgba(153, 255, 0, 1)',
    capacity_factor_20: 'rgba(102, 255, 0, 1)',
    capacity_factor_10: 'rgba(51, 255, 0, 1)',
    capacity_factor_0: 'rgba(0, 255, 0, 1)',

    // Load utilization colors (for lines and transformers)
    load_utilization_low: 'rgba(34, 197, 94, 0.9)',           // Green 0-40%
    load_utilization_moderate: 'rgba(132, 204, 22, 0.9)',     // Lime 40-60%
    load_utilization_medium: 'rgba(234, 179, 8, 0.9)',        // Yellow 60-80%
    load_utilization_high: 'rgba(249, 115, 22, 0.9)',         // Orange 80-100%
    load_utilization_critical: 'rgba(239, 68, 68, 0.9)',      // Red >100%

    // Demand colors (based on yearly kWh consumption)
    demand_very_high: 'rgba(239, 68, 68, 0.8)',               // >50,000 kWh
    demand_high: 'rgba(249, 115, 22, 0.8)',                   // 20,000-50,000 kWh
    demand_medium: 'rgba(234, 179, 8, 0.8)',                  // 10,000-20,000 kWh
    demand_low: 'rgba(132, 204, 22, 0.8)',                    // 5,000-10,000 kWh
    demand_very_low: 'rgba(34, 197, 94, 0.8)',                // <5,000 kWh
} as const;
