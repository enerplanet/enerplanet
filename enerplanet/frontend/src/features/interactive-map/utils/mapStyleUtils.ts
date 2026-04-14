/**
 * Map styling utilities for building features
 */

import { Style, Fill, Stroke, Circle as CircleStyle, Icon, RegularShape, Text } from 'ol/style';
import type { StyleFunction } from 'ol/style/Style';
import type { Feature } from 'ol';
import type { Geometry } from 'ol/geom';
import type { FeatureLike } from 'ol/Feature';
import { Point } from 'ol/geom';
import { getCenter } from 'ol/extent';
import { ColorConfig } from '@/constants/color-config';
import { getPrimaryFClassFromClasses, parseFClassValue } from '@/features/configurator/utils/fClassUtils';

// Helper function to get line width based on voltage or capacity
function getLineWidth(feature: Feature<Geometry>, baseWidth: number = 2): number {
    const voltage = feature.get('vn_kv') || feature.get('voltage_kv');
    const capacity = feature.get('s_nom') || feature.get('capacity_mva');

    if (voltage) {
        if (voltage >= 110) return baseWidth + 4;      // High voltage
        if (voltage >= 20) return baseWidth + 2;       // Medium voltage
        if (voltage >= 0.4) return baseWidth;          // Low voltage
    }

    if (capacity) {
        return Math.min(baseWidth + Math.log10(capacity) * 2, 8);
    }

    return baseWidth;
}

// Helper function to get color based on load utilization (green to red gradient)
function getLoadUtilizationColor(feature: Feature<Geometry>): string | null {
    const loading = feature.get('loading_percent') ?? feature.get('utilization');

    if (loading === undefined || loading === null) return null;

    if (loading >= 100) return ColorConfig.load_utilization_critical;    // Red - overloaded
    if (loading >= 80) return ColorConfig.load_utilization_high;         // Orange - high load
    if (loading >= 60) return ColorConfig.load_utilization_medium;       // Yellow - medium load
    if (loading >= 40) return ColorConfig.load_utilization_moderate;     // Lime - moderate
    return ColorConfig.load_utilization_low;                             // Green - low load
}

// Helper function to get color based on energy demand
function getDemandColor(yearlyDemandKwh: number): string {
    if (yearlyDemandKwh >= 50000) return ColorConfig.demand_very_high;   // Red - high demand
    if (yearlyDemandKwh >= 20000) return ColorConfig.demand_high;        // Orange
    if (yearlyDemandKwh >= 10000) return ColorConfig.demand_medium;      // Yellow
    if (yearlyDemandKwh >= 5000) return ColorConfig.demand_low;          // Lime
    return ColorConfig.demand_very_low;                                   // Green - low demand
}

// Helper function to check if a line is planned/proposed
function isPlannedLine(feature: Feature<Geometry>): boolean {
    return feature.get('planned') === true ||
           feature.get('proposed') === true ||
           feature.get('status') === 'planned' ||
           feature.get('status') === 'proposed';
}

export const DARK_CLUSTER_COLORS = [
    '#1e3a5f', '#2d5a27', '#6b2737', '#4a3728', '#3d2b56',
    '#1a4d4d', '#5c3d2e', '#2b4a2b', '#4d1f4d', '#1f3d3d',
    '#5a3d1a', '#3b1f3b', '#1a3d5c', '#4d3319', '#2e4a3d',
    '#4a2d4a', '#3d4a1f', '#5c2d2d', '#1f4a5c', '#4d4d1a',
];

function getTransformerColor(index: number, alpha: number = 0.9): string {
    if (index < DARK_CLUSTER_COLORS.length) {
        const hex = DARK_CLUSTER_COLORS[index];
        const r = Number.parseInt(hex.slice(1, 3), 16);
        const g = Number.parseInt(hex.slice(3, 5), 16);
        const b = Number.parseInt(hex.slice(5, 7), 16);
        return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    }

    const goldenAngle = 137.508;
    const hue = (index * goldenAngle) % 360;
    const saturation = 60 + (index % 3) * 10;
    const lightness = 25 + (Math.floor(index / 3) % 3) * 5;
    return `hsla(${hue}, ${saturation}%, ${lightness}%, ${alpha})`;
}

const STATIC_TECH_CLASSES = new Set(["transformer", "zd", "cd", "sp", "wf"]);

function normalizeClassToken(value: string): string {
    return value
        .trim()
        .toLowerCase()
        .replace(/[-\s]+/g, "_")
        .replace(/__+/g, "_")
        .replace(/^_+|_+$/g, "");
}

function hashClass(value: string): number {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
        hash = (hash << 5) - hash + value.charCodeAt(i);
        hash |= 0;
    }
    return Math.abs(hash);
}

function resolvePrimaryFClass(feature: Feature<Geometry>): string | null {
    const classes = [
        ...parseFClassValue(feature.get("f_classes")),
        ...parseFClassValue(feature.get("f_class")),
        ...parseFClassValue(feature.get("fclass")),
    ];
    const primary = getPrimaryFClassFromClasses(classes);
    if (primary) {
        const normalized = normalizeClassToken(primary);
        if (normalized) return normalized;
    }

    const typeClass = feature.get("type");
    if (typeof typeClass === "string") {
        const normalized = normalizeClassToken(typeClass);
        if (normalized) return normalized;
    }

    return null;
}

function resolveStaticClass(value: unknown): string | null {
    if (typeof value !== "string") return null;

    const normalized = normalizeClassToken(value);
    if (!normalized) return null;

    if (STATIC_TECH_CLASSES.has(normalized)) return normalized;

    return null;
}

export function parsePoiClass(feature: Feature<Geometry>): string | null {
    const featureType = feature.get("feature_type");

    if (featureType === "TopologyNode" || featureType === "transformer") {
        return "transformer";
    }

    if (featureType === "POI" || featureType === "building" || featureType === "BasePOI" || featureType === "CustomPOI") {
        const fClass = feature.get("f_class");
        if (typeof fClass === "string" && fClass.toLowerCase().includes("trafo")) {
            return "transformer";
        }

        const fromFClass = resolvePrimaryFClass(feature);
        if (fromFClass) return fromFClass;
    }

    return resolveStaticClass(feature.get("type"));
}

function getClassificationColor(classification: string | null): string {
    const lowerClass = classification ? normalizeClassToken(classification) : "";
    if (!lowerClass) return ColorConfig.zd_demand_background;

    switch (lowerClass) {
        case "transformer":
            return ColorConfig.transformer_supply_background;
        case "zd":
            return ColorConfig.zd_demand_background;
        case "cd":
            return ColorConfig.cd_demand_background;
        case "sp":
            return ColorConfig.sp_supply_background;
        case "wf":
            return ColorConfig.wf_supply_background;
        default: {
            const idx = hashClass(lowerClass) % ColorConfig.cluster_colors.length;
            return ColorConfig.cluster_colors[idx];
        }
    }
}

function toTransparentColor(rgba: string, alpha: number): string {
    const match = /rgba?\s*\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([0-9.]+))?\s*\)/i.exec(rgba);
    if (!match) return rgba;
    const [, r, g, b] = match;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Helper to calculate icon scale based on resolution (zoom level)
// Higher resolution = more zoomed out = smaller icons
// Lower resolution = more zoomed in = larger icons
function getIconScale(resolution: number, baseScale: number = 0.8): number {
    const minScale = 0.1;  // Tiny when zoomed out
    const maxScale = baseScale;  // Normal size when zoomed in

    // Hide icons completely when zoomed out (seeing whole area)
    // Resolution ~5+ means quite zoomed out
    if (resolution >= 5) return 0;

    // Clamp resolution to reasonable bounds
    if (resolution <= 0.2) return maxScale;
    if (resolution >= 4) return minScale;

    // Logarithmic interpolation for scaling
    const t = Math.log(resolution / 0.2) / Math.log(4 / 0.2);
    return maxScale - (maxScale - minScale) * t;
}

function getIconRadius(resolution: number, baseRadius: number = 14): number {
    const minRadius = 2;  // Tiny when zoomed out
    const maxRadius = baseRadius;  // Normal size when zoomed in

    // Hide when zoomed out
    if (resolution >= 5) return 0;

    if (resolution <= 0.2) return maxRadius;
    if (resolution >= 4) return minRadius;

    const t = Math.log(resolution / 0.2) / Math.log(4 / 0.2);
    return maxRadius - (maxRadius - minRadius) * t;
}

function getIconSpacing(resolution: number, baseSpacing: number = 28): number {
    const minSpacing = 4;
    const maxSpacing = baseSpacing;  // Normal spacing when zoomed in

    if (resolution <= 0.2) return maxSpacing;
    if (resolution >= 4) return minSpacing;

    const t = Math.log(resolution / 0.2) / Math.log(4 / 0.2);
    return maxSpacing - (maxSpacing - minSpacing) * t;
}

// Helper to add tech indicator icons to a feature's styles
function addTechIconStyles(
    styles: Style[],
    feature: Feature<Geometry>,
    resolution: number | undefined,
    strokeColor: string = '#1a1a2e',
    baseZIndex: number = 1001
): void {
    const techs = feature.get('techs');
    if (!techs || typeof techs !== 'object' || Object.keys(techs).length === 0) return;

    const techKeys = Object.keys(techs);
    const numTechs = techKeys.length;
    const geometry = feature.getGeometry();
    if (!geometry) return;

    const extent = geometry.getExtent();
    const center = getCenter(extent);
    const currentResolution = resolution || 1;
    const iconScale = getIconScale(currentResolution, 0.85);
    const iconRadius = getIconRadius(currentResolution, 14);

    if (iconScale <= 0 || iconRadius <= 0) return;

    const iconSpacing = getIconSpacing(currentResolution, 24);
    const startOffset = -((numTechs - 1) * iconSpacing) / 2;

    techKeys.forEach((key, index) => {
        const tech = techs[key];
        const techIcon = tech?.icon || 'default';
        const iconPath = `/images/tech-icons/${techIcon}.svg`;
        const offsetX = startOffset + (index * iconSpacing);

        // White background circle + Tech icon
        styles.push(
            new Style({
                geometry: new Point(center),
                image: new CircleStyle({
                    radius: iconRadius,
                    fill: new Fill({ color: '#ffffff' }),
                    stroke: new Stroke({ color: strokeColor, width: Math.max(0.5, 1.5 * (iconRadius / 10)) }),
                    displacement: [offsetX, 0]
                }),
                zIndex: baseZIndex + index
            }),
            new Style({
                geometry: new Point(center),
                image: new Icon({
                    src: iconPath,
                    scale: iconScale,
                    anchor: [0.5, 0.5],
                    anchorXUnits: 'fraction',
                    anchorYUnits: 'fraction',
                    displacement: [offsetX, 0]
                }),
                zIndex: baseZIndex + 1 + index
            })
        );
    });
}

// Returns a style function for OpenLayers that responds to zoom/resolution changes
export function createBuildingStyleFunction(
    colorByTransformer: boolean = false,
    colorByDemand: boolean = false,
): StyleFunction {
    return (feature: FeatureLike, resolution: number): Style | Style[] | void => {
        return buildingSimpleStyleFunction(feature as Feature<Geometry>, colorByTransformer, colorByDemand, resolution);
    };
}

// Returns a highlight style function for OpenLayers that responds to zoom/resolution changes
export function createBuildingHighlightStyleFunction(): StyleFunction {
    return (feature: FeatureLike, resolution: number): Style | Style[] | void => {
        return buildingHighlightStyleFunction(feature as Feature<Geometry>, resolution);
    };
}

// Helper to determine building color based on state and configuration
function determineBuildingColor(
    feature: Feature<Geometry>,
    classification: string | null,
    colorByTransformer: boolean,
    colorByDemand: boolean = false
): string {
    const isDeactivated = feature.get('activated') === false;
    if (isDeactivated) return ColorConfig.deactivated;

    // If colorByDemand is enabled and demand data exists, use demand-based coloring
    if (colorByDemand) {
        const demand = feature.get('yearly_demand_kwh') ?? feature.get('annual_consumption_kwh') ?? 0;
        if (demand > 0) {
            return getDemandColor(demand);
        }
    }

    if (!colorByTransformer) return getClassificationColor(classification);

    const colorIndex = feature.get('_color_index');
    if (colorIndex !== undefined && colorIndex !== null) {
        return getTransformerColor(colorIndex);
    }

    const transformerId = feature.get('grid_result_id') ?? feature.get('transformer_id') ?? feature.get('trafo_id') ?? feature.get('cluster_id');
    if (transformerId === undefined || transformerId === null) {
        return getClassificationColor(classification);
    }

    const clusterIndex = typeof transformerId === 'number' ? transformerId : Number.parseInt(String(transformerId), 10);
    return Number.isNaN(clusterIndex) ? getClassificationColor(classification) : getTransformerColor(Math.abs(clusterIndex));
}

function buildingSimpleStyleFunction(
    feature: Feature<Geometry>,
    colorByTransformer: boolean = false,
    colorByDemand: boolean = false,
    resolution?: number
): Style | Style[] {
    const classification = parsePoiClass(feature);
    const osmId = feature.get('osm_id');
    const isCustomBuilding = osmId !== undefined && (typeof osmId === 'number' ? osmId < 0 : String(osmId).startsWith('-'));
    const currentResolution = resolution || 1;

    const finalColor = determineBuildingColor(feature, classification, colorByTransformer, colorByDemand);
    const geomType = feature.getGeometry()?.getType();

    const styles: Style[] = [];

    // Progressive disclosure: simplified style at low zoom (resolution > 4)
    if (currentResolution > 4) {
        if (geomType === 'Point' || geomType === 'MultiPoint') {
            return new Style({
                image: new CircleStyle({
                    radius: 3,
                    fill: new Fill({ color: 'rgba(156, 163, 175, 0.5)' }),
                    stroke: new Stroke({ color: '#9ca3af', width: 0.5 })
                })
            });
        }
        return new Style({
            fill: new Fill({ color: 'rgba(156, 163, 175, 0.5)' }),
            stroke: new Stroke({ color: '#9ca3af', width: 0.5 })
        });
    }

    // Medium zoom (resolution 2-4): basic colored style without icons
    if (currentResolution > 2) {
        const transparentFill = toTransparentColor(finalColor, 0.7);
        if (geomType === 'Point' || geomType === 'MultiPoint') {
            return new Style({
                image: new CircleStyle({
                    radius: 5,
                    fill: new Fill({ color: transparentFill }),
                    stroke: new Stroke({ color: finalColor, width: 1 })
                })
            });
        }
        return [
            new Style({
                fill: new Fill({ color: transparentFill }),
                zIndex: 99
            }),
            new Style({
                stroke: new Stroke({ color: '#ffffff', width: 1 }),
                zIndex: 100
            })
        ];
    }

    // High zoom (resolution < 2): full detail with icons and labels
    const fillColor = toTransparentColor(finalColor, 1);

    if (geomType === 'Point' || geomType === 'MultiPoint') {
        styles.push(new Style({
            image: new CircleStyle({
                radius: 7,
                fill: new Fill({ color: fillColor }),
                stroke: new Stroke({ color: finalColor, width: 2 })
            })
        }));
    } else {
        // Fill with good saturation
        const transparentFill = toTransparentColor(finalColor, 0.85);
        styles.push(
            new Style({
                fill: new Fill({ color: transparentFill }),
                zIndex: 99
            }),
            // White boundary stroke to show division between adjacent buildings
            new Style({
                stroke: new Stroke({ color: '#ffffff', width: 1.5 }),
                zIndex: 100
            })
        );
    }

    // Add icon for custom buildings
    if (isCustomBuilding) {
        const geometry = feature.getGeometry();
        if (geometry) {
            const extent = geometry.getExtent();
            const center = getCenter(extent);
            const iconScale = getIconScale(currentResolution, 0.9);
            const iconRadius = getIconRadius(currentResolution, 16);

            if (iconScale > 0 && iconRadius > 0) {
                const customIcon = feature.get('icon') || 'building-2';
                const iconPath = `/images/tech-icons/${customIcon}.svg`;

                // Background circle + Custom building icon
                styles.push(
                    new Style({
                        geometry: new Point(center),
                        image: new CircleStyle({
                            radius: iconRadius,
                            fill: new Fill({ color: '#ffffff' }),
                            stroke: new Stroke({ color: finalColor, width: Math.max(1, 2 * (iconRadius / 12)) }),
                        }),
                        zIndex: 1001
                    }),
                    new Style({
                        geometry: new Point(center),
                        image: new Icon({
                            src: iconPath,
                            scale: iconScale,
                            anchor: [0.5, 0.5],
                            anchorXUnits: 'fraction',
                            anchorYUnits: 'fraction',
                        }),
                        zIndex: 1002
                    })
                );
            }
        }
    }

    // Add tech indicator icons if building has technologies
    addTechIconStyles(styles, feature, resolution, '#1a1a2e', 1001);

    return styles;
}

// Helper to get utilization color for capacity bars
function getUtilizationBarColor(utilization: number): string {
    if (utilization >= 80) return '#ef4444';  // Red
    if (utilization >= 60) return '#eab308';  // Yellow
    return '#22c55e';                          // Green
}

export function transformerStyleFunction(feature?: Feature<Geometry>, resolution?: number): Style[] {
    const colorIndex = feature?.get('_color_index');
    // Yellow/amber - standard color for transformers in electrical diagrams (IEC)
    let markerColor = '#f59e0b';

    if (colorIndex !== undefined && colorIndex !== null) {
        markerColor = getTransformerColor(colorIndex, 1);
    }

    // Get rated power for size scaling (larger transformers = bigger markers)
    const ratedPower = feature?.get('rated_power_kva') || 400;
    const baseRadius = Math.min(Math.max(10 + Math.log10(ratedPower) * 2.5, 10), 16);

    // Calculate utilization for capacity bar and warning icon
    const currentLoad = feature?.get('current_load_kw') ?? (feature?.get('p_mw') ? feature.get('p_mw') * 1000 : 0);
    const utilization = ratedPower > 0 ? Math.min((currentLoad / ratedPower) * 100, 120) : 0;

    const styles: Style[] = [
        // Soft outer glow (circular, modern)
        new Style({
            image: new CircleStyle({
                radius: baseRadius + 6,
                fill: new Fill({ color: 'rgba(245, 158, 11, 0.12)' }),
            }),
            zIndex: 995
        }),
        // Drop shadow
        new Style({
            image: new CircleStyle({
                radius: baseRadius + 1,
                fill: new Fill({ color: 'rgba(0, 0, 0, 0.18)' }),
                displacement: [1.5, -1.5]
            }),
            zIndex: 996
        }),
        // White background circle
        new Style({
            image: new CircleStyle({
                radius: baseRadius,
                fill: new Fill({ color: '#ffffff' }),
                stroke: new Stroke({ color: markerColor, width: 2.5 })
            }),
            zIndex: 997
        }),
        // Colored inner ring
        new Style({
            image: new CircleStyle({
                radius: baseRadius - 3,
                fill: new Fill({ color: markerColor }),
            }),
            zIndex: 998
        }),
        // Transformer icon
        new Style({
            image: new Icon({
                src: '/images/transformer-icon.svg',
                scale: 0.7,
                anchor: [0.5, 0.5],
                anchorXUnits: 'fraction',
                anchorYUnits: 'fraction',
            }),
            zIndex: 999
        })
    ];

    // Add capacity bar if there's load data (only when somewhat zoomed in)
    if (currentLoad > 0 && (!resolution || resolution < 4)) {
        const barWidth = baseRadius * 1.5;
        const barHeight = 3;
        const fillWidth = Math.max((utilization / 100) * barWidth, 1);
        const barColor = getUtilizationBarColor(utilization);

        // Background bar (gray)
        styles.push(
            new Style({
                image: new RegularShape({
                    points: 4,
                    radius: barWidth / 2,
                    radius2: barHeight / 2,
                    angle: 0,
                    fill: new Fill({ color: '#e5e7eb' }),
                    stroke: new Stroke({ color: '#9ca3af', width: 0.5 }),
                    displacement: [0, baseRadius + 8]
                }),
                zIndex: 1000
            })
        );

        // Fill bar (colored based on utilization)
        styles.push(
            new Style({
                image: new RegularShape({
                    points: 4,
                    radius: fillWidth / 2,
                    radius2: barHeight / 2,
                    angle: 0,
                    fill: new Fill({ color: barColor }),
                    displacement: [-(barWidth - fillWidth) / 2, baseRadius + 8]
                }),
                zIndex: 1001
            })
        );
    }

    // Add warning icon when utilization >= 80%
    if (utilization >= 80 && (!resolution || resolution < 4)) {
        styles.push(
            new Style({
                image: new Icon({
                    src: '/images/warning-icon.svg',
                    scale: 0.5,
                    anchor: [0.5, 1],
                    anchorXUnits: 'fraction',
                    anchorYUnits: 'fraction',
                    displacement: [baseRadius + 6, -baseRadius - 6]
                }),
                zIndex: 1002
            })
        );
    }

    // Show kVA label when zoomed in (resolution < 2)
    if (resolution && resolution < 2) {
        styles.push(
            new Style({
                text: new Text({
                    text: `${ratedPower} kVA`,
                    font: '600 10px Inter, -apple-system, sans-serif',
                    fill: new Fill({ color: '#1f2937' }),
                    stroke: new Stroke({ color: '#ffffff', width: 3 }),
                    offsetY: baseRadius + (currentLoad > 0 ? 20 : 14),
                    textAlign: 'center'
                }),
                zIndex: 1003
            })
        );
    }

    return styles;
}

function buildingHighlightStyleFunction(feature: Feature<Geometry>, resolution?: number): Style[] {
    const classification = parsePoiClass(feature);
    const colorIndex = feature.get('_color_index');

    let baseColor: string;
    if (colorIndex !== undefined && colorIndex !== null) {
        baseColor = getTransformerColor(colorIndex);
    } else {
        baseColor = getClassificationColor(classification);
    }

    const fillColor = toTransparentColor(baseColor, 0.5);
    const geomType = feature.getGeometry()?.getType();

    const styles: Style[] = [];

    // Outer glow effect
    if (geomType === 'Point' || geomType === 'MultiPoint') {
        styles.push(
            new Style({
                image: new CircleStyle({
                    radius: 12,
                    fill: new Fill({ color: 'rgba(59, 130, 246, 0.3)' }), // blue glow
                    stroke: new Stroke({ color: '#3b82f6', width: 3, lineDash: [4, 4] })
                }),
                zIndex: 900
            }),
            new Style({
                image: new CircleStyle({
                    radius: 7,
                    fill: new Fill({ color: fillColor }),
                    stroke: new Stroke({ color: '#3b82f6', width: 2 })
                }),
                zIndex: 901
            })
        );
    } else {
        // Fill with good saturation for highlighted buildings
        styles.push(
            new Style({
                fill: new Fill({ color: 'rgba(59, 130, 246, 0.7)' }),
                zIndex: 900
            }),
            // White boundary stroke to show division between adjacent buildings
            new Style({
                stroke: new Stroke({ color: '#ffffff', width: 2 }),
                zIndex: 901
            }),
            // Blue dashed outline
            new Style({
                stroke: new Stroke({ color: '#3b82f6', width: 2, lineDash: [6, 4] }),
                zIndex: 902
            })
        );
    }

    // Add tech indicator icons with highlight color
    addTechIconStyles(styles, feature, resolution, '#3b82f6', 1001);

    return styles;
}

export function cableStyleFunction(feature: Feature<Geometry>): Style[] {
    const colorIndex = feature.get('_color_index');
    let lineColor: string;

    // Check for load utilization color first
    const loadColor = getLoadUtilizationColor(feature);
    if (loadColor) {
        lineColor = loadColor;
    } else if (colorIndex !== undefined && colorIndex !== null) {
        lineColor = getTransformerColor(colorIndex, 1);
    } else {
        const gridResultId = feature.get('grid_result_id');
        if (gridResultId !== undefined && gridResultId !== null) {
            const clusterIndex = typeof gridResultId === 'number' ? gridResultId : Number.parseInt(String(gridResultId), 10);
            if (Number.isNaN(clusterIndex)) {
                lineColor = ColorConfig.power_line_low_voltage;
            } else {
                lineColor = getTransformerColor(Math.abs(clusterIndex) % 20, 1);
            }
        } else {
            lineColor = ColorConfig.power_line_low_voltage;
        }
    }

    // Calculate line width based on voltage/capacity
    const lineWidth = getLineWidth(feature, 2);

    // Check if planned/proposed (use dashed line)
    const isPlanned = isPlannedLine(feature);
    const dashPattern = isPlanned ? [8, 6] : undefined;

    // Parse the primary color to extract RGB values for shading
    const rgbaMatch = lineColor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    const r = rgbaMatch ? parseInt(rgbaMatch[1]) : 59;
    const g = rgbaMatch ? parseInt(rgbaMatch[2]) : 130;
    const b = rgbaMatch ? parseInt(rgbaMatch[3]) : 246;

    // Create darker shade for 3D depth effect
    const shadowColor = `rgba(${Math.max(0, r - 50)}, ${Math.max(0, g - 50)}, ${Math.max(0, b - 50)}, 0.5)`;

    // Cable styling with subtle 3D depth - shadow underneath, main cable on top
    return [
        // Shadow/depth layer
        new Style({
            stroke: new Stroke({
                color: shadowColor,
                width: lineWidth + 1,
                lineCap: 'round',
                lineJoin: 'round',
                lineDash: dashPattern
            })
        }),
        // Main cable
        new Style({
            stroke: new Stroke({
                color: lineColor,
                width: lineWidth,
                lineCap: 'round',
                lineJoin: 'round',
                lineDash: dashPattern
            })
        })
    ];
}

// MV Lines style
export function mvLineStyleFunction(feature: Feature<Geometry>): Style[] {
    const normallyOpen = feature.get('normally_open');
    const isPlanned = isPlannedLine(feature);

    // Check for load utilization color first, otherwise use default orange
    const loadColor = getLoadUtilizationColor(feature);
    const primaryColor = loadColor || '#f97316'; // Orange-500 default

    // Dashed if normally open OR planned
    const dashPattern = (normallyOpen || isPlanned) ? [12, 6] : undefined;

    // Calculate line width based on voltage/capacity
    const baseWidth = getLineWidth(feature, 2);

    // Generate glow colors from primary color
    const glowColor = loadColor
        ? loadColor.replace(/[\d.]+\)$/, '0.15)')
        : 'rgba(249, 115, 22, 0.15)';
    const innerGlow = loadColor
        ? loadColor.replace(/[\d.]+\)$/, '0.35)')
        : 'rgba(251, 146, 60, 0.35)';

    return [
        // Outer soft glow
        new Style({
            stroke: new Stroke({
                color: glowColor,
                width: baseWidth + 8,
                lineCap: 'round',
                lineJoin: 'round',
                lineDash: dashPattern
            })
        }),
        // Inner glow
        new Style({
            stroke: new Stroke({
                color: innerGlow,
                width: baseWidth + 3,
                lineCap: 'round',
                lineJoin: 'round',
                lineDash: dashPattern
            })
        }),
        // Core line
        new Style({
            stroke: new Stroke({
                color: primaryColor,
                width: baseWidth,
                lineCap: 'round',
                lineJoin: 'round',
                lineDash: dashPattern
            })
        })
    ];
}

/**
 * Zoom-dependent: clean at every level, no clutter when zoomed out
 */
export function boundaryStyleFunction(_feature: Feature<Geometry>, resolution?: number): Style[] {
    const res = resolution || 1;

    // Zoomed out (seeing large area) — clean solid line, no dashes
    if (res > 20) {
        return [
            // Soft outer glow
            new Style({
                stroke: new Stroke({
                    color: 'rgba(99, 102, 241, 0.10)',
                    width: 6,
                    lineCap: 'round',
                    lineJoin: 'round'
                })
            }),
            // Solid line
            new Style({
                fill: new Fill({
                    color: 'rgba(99, 102, 241, 0.04)'
                }),
                stroke: new Stroke({
                    color: 'rgba(79, 70, 229, 0.6)',
                    width: 2,
                    lineCap: 'round',
                    lineJoin: 'round'
                })
            })
        ];
    }

    // Medium zoom — solid line with stronger presence
    if (res > 5) {
        return [
            // Outer glow
            new Style({
                stroke: new Stroke({
                    color: 'rgba(99, 102, 241, 0.12)',
                    width: 8,
                    lineCap: 'round',
                    lineJoin: 'round'
                })
            }),
            // Fill + main line
            new Style({
                fill: new Fill({
                    color: 'rgba(99, 102, 241, 0.05)'
                }),
                stroke: new Stroke({
                    color: 'rgba(79, 70, 229, 0.75)',
                    width: 2.5,
                    lineDash: [16, 8],
                    lineCap: 'round',
                    lineJoin: 'round'
                })
            }),
            // White inner accent
            new Style({
                stroke: new Stroke({
                    color: 'rgba(255, 255, 255, 0.5)',
                    width: 1,
                    lineDash: [16, 8],
                    lineDashOffset: 4,
                    lineCap: 'round'
                })
            })
        ];
    }

    // Zoomed in — full detail with depth
    return [
        // Outer glow
        new Style({
            stroke: new Stroke({
                color: 'rgba(99, 102, 241, 0.10)',
                width: 10,
                lineCap: 'round',
                lineJoin: 'round'
            })
        }),
        // Shadow
        new Style({
            stroke: new Stroke({
                color: 'rgba(55, 48, 163, 0.15)',
                width: 6,
                lineCap: 'round',
                lineJoin: 'round'
            })
        }),
        // Main boundary line
        new Style({
            fill: new Fill({
                color: 'rgba(99, 102, 241, 0.06)'
            }),
            stroke: new Stroke({
                color: 'rgba(67, 56, 202, 0.85)',
                width: 2.5,
                lineDash: [16, 8],
                lineCap: 'round',
                lineJoin: 'round'
            })
        }),
        // White accent line for contrast
        new Style({
            stroke: new Stroke({
                color: 'rgba(255, 255, 255, 0.55)',
                width: 1,
                lineDash: [16, 8],
                lineDashOffset: 4,
                lineCap: 'round'
            })
        })
    ];
}

/**
 * Style for selected/highlighted region boundary — uses a distinct orange/amber color
 * to clearly differentiate from the default indigo boundaries.
 */
export function selectedBoundaryStyleFunction(_feature: Feature<Geometry>, resolution?: number): Style[] {
    const res = resolution || 1;

    if (res > 20) {
        return [
            new Style({
                stroke: new Stroke({
                    color: 'rgba(245, 158, 11, 0.15)',
                    width: 8,
                    lineCap: 'round',
                    lineJoin: 'round'
                })
            }),
            new Style({
                fill: new Fill({
                    color: 'rgba(245, 158, 11, 0.08)'
                }),
                stroke: new Stroke({
                    color: 'rgba(217, 119, 6, 0.8)',
                    width: 3,
                    lineCap: 'round',
                    lineJoin: 'round'
                })
            })
        ];
    }

    if (res > 5) {
        return [
            new Style({
                stroke: new Stroke({
                    color: 'rgba(245, 158, 11, 0.18)',
                    width: 10,
                    lineCap: 'round',
                    lineJoin: 'round'
                })
            }),
            new Style({
                fill: new Fill({
                    color: 'rgba(245, 158, 11, 0.10)'
                }),
                stroke: new Stroke({
                    color: 'rgba(217, 119, 6, 0.85)',
                    width: 3,
                    lineDash: [16, 8],
                    lineCap: 'round',
                    lineJoin: 'round'
                })
            }),
            new Style({
                stroke: new Stroke({
                    color: 'rgba(255, 255, 255, 0.6)',
                    width: 1,
                    lineDash: [16, 8],
                    lineDashOffset: 4,
                    lineCap: 'round'
                })
            })
        ];
    }

    return [
        new Style({
            stroke: new Stroke({
                color: 'rgba(245, 158, 11, 0.15)',
                width: 12,
                lineCap: 'round',
                lineJoin: 'round'
            })
        }),
        new Style({
            stroke: new Stroke({
                color: 'rgba(180, 83, 9, 0.20)',
                width: 7,
                lineCap: 'round',
                lineJoin: 'round'
            })
        }),
        new Style({
            fill: new Fill({
                color: 'rgba(245, 158, 11, 0.10)'
            }),
            stroke: new Stroke({
                color: 'rgba(217, 119, 6, 0.9)',
                width: 3,
                lineDash: [16, 8],
                lineCap: 'round',
                lineJoin: 'round'
            })
        }),
        new Style({
            stroke: new Stroke({
                color: 'rgba(255, 255, 255, 0.6)',
                width: 1,
                lineDash: [16, 8],
                lineDashOffset: 4,
                lineCap: 'round'
            })
        })
    ];
}

/**
 * Style for search result boundary — uses a bold rose/magenta color
 * to clearly stand out from default (indigo), selected (amber), and the green map background.
 */
export function searchBoundaryStyleFunction(_feature: Feature<Geometry>, resolution?: number): Style[] {
    const res = resolution || 1;

    if (res > 20) {
        return [
            new Style({
                stroke: new Stroke({
                    color: 'rgba(190, 24, 93, 0.20)',
                    width: 8,
                    lineCap: 'round',
                    lineJoin: 'round'
                })
            }),
            new Style({
                stroke: new Stroke({
                    color: 'rgba(190, 24, 93, 0.85)',
                    width: 3,
                    lineCap: 'round',
                    lineJoin: 'round'
                })
            })
        ];
    }

    if (res > 5) {
        return [
            new Style({
                stroke: new Stroke({
                    color: 'rgba(190, 24, 93, 0.22)',
                    width: 10,
                    lineCap: 'round',
                    lineJoin: 'round'
                })
            }),
            new Style({
                stroke: new Stroke({
                    color: 'rgba(190, 24, 93, 0.88)',
                    width: 3,
                    lineDash: [16, 8],
                    lineCap: 'round',
                    lineJoin: 'round'
                })
            }),
            new Style({
                stroke: new Stroke({
                    color: 'rgba(255, 255, 255, 0.6)',
                    width: 1,
                    lineDash: [16, 8],
                    lineDashOffset: 4,
                    lineCap: 'round'
                })
            })
        ];
    }

    return [
        new Style({
            stroke: new Stroke({
                color: 'rgba(190, 24, 93, 0.20)',
                width: 12,
                lineCap: 'round',
                lineJoin: 'round'
            })
        }),
        new Style({
            stroke: new Stroke({
                color: 'rgba(131, 24, 67, 0.25)',
                width: 7,
                lineCap: 'round',
                lineJoin: 'round'
            })
        }),
        new Style({
            stroke: new Stroke({
                color: 'rgba(190, 24, 93, 0.92)',
                width: 3,
                lineDash: [16, 8],
                lineCap: 'round',
                lineJoin: 'round'
            })
        }),
        new Style({
            stroke: new Stroke({
                color: 'rgba(255, 255, 255, 0.6)',
                width: 1,
                lineDash: [16, 8],
                lineDashOffset: 4,
                lineCap: 'round'
            })
        })
    ];
}

/**
 * Only shown when zoomed in enough to avoid clutter
 */
export function boundaryLabelStyle(name: string, geometry: Geometry, resolution?: number): Style {
    const center = getCenter(geometry.getExtent());
    const res = resolution || 1;

    // Hide label when zoomed out — the boundary line is enough
    if (res > 20) {
        return new Style({});
    }

    const fontSize = res > 5 ? 11 : 13;

    return new Style({
        geometry: new Point(center),
        text: new Text({
            text: name.toUpperCase(),
            font: `600 ${fontSize}px Inter, -apple-system, BlinkMacSystemFont, sans-serif`,
            fill: new Fill({ color: '#312e81' }),
            stroke: new Stroke({
                color: 'rgba(255, 255, 255, 0.95)',
                width: 3.5
            }),
            backgroundFill: new Fill({
                color: 'rgba(238, 242, 255, 0.92)'
            }),
            backgroundStroke: new Stroke({
                color: 'rgba(99, 102, 241, 0.4)',
                width: 1
            }),
            padding: [6, 12, 6, 12],
            overflow: true,
            offsetY: 0
        })
    });
}
