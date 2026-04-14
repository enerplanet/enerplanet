import type { Feature } from "ol";
import type { Geometry } from "ol/geom";

import type { PylovoGridData } from "@/features/configurator/types/area-select";

const parseFlexibleNumberString = (input: string): number | null => {
    const trimmed = input.trim();
    if (!trimmed) return null;

    const compact = trimmed.replace(/[\s\u00A0\u202F]/g, "");

    // 1,234.56
    if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(compact)) {
        const parsed = Number(compact.replace(/,/g, ""));
        return Number.isFinite(parsed) ? parsed : null;
    }

    // 1.234,56
    if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(compact)) {
        const parsed = Number(compact.replace(/\./g, "").replace(",", "."));
        return Number.isFinite(parsed) ? parsed : null;
    }

    const normalized = compact.includes(",") && !compact.includes(".")
        ? compact.replace(",", ".")
        : compact;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : null;
};

const toFiniteNumber = (value: unknown): number | null => {
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string") {
        return parseFlexibleNumberString(value);
    }
    return null;
};

export const extractTransformerId = (props: Record<string, unknown> | undefined): number | null => {
    const tID = props?.grid_result_id ?? props?.transformer_id;
    if (tID === undefined || tID === null) return null;
    return toFiniteNumber(tID);
};

export const collectTransformerIds = (features: Array<{ properties?: Record<string, unknown> | null }>): Set<number> => {
    const ids = new Set<number>();
    for (const feature of features) {
        const transformerID = extractTransformerId(feature.properties ?? undefined);
        if (transformerID !== null) ids.add(transformerID);
    }
    return ids;
};

const extractLineGridId = (props: Record<string, unknown> | null | undefined): number | null => {
    if (!props) return null;
    return toFiniteNumber(props.grid_result_id ?? props.transformer_id ?? props.trafo_id);
};

const normalizeOsmToken = (value: unknown): string | null => {
    if (value === undefined || value === null) return null;
    const raw = String(value).trim();
    if (!raw) return null;

    const num = toFiniteNumber(raw);
    if (num !== null) return String(num);

    const customMatch = raw.match(/^custom[/:_-]?(\d+)$/i);
    if (customMatch) return `custom_${customMatch[1]}`;

    return raw;
};

const addTokenVariants = (target: Set<string>, value: unknown): void => {
    const token = normalizeOsmToken(value);
    if (!token) return;
    target.add(token);

    const customMatch = token.match(/^custom_(\d+)$/i);
    if (customMatch) {
        target.add(`custom/${customMatch[1]}`);
    }
};

const extractLinkedBuildingTokensFromLine = (props: Record<string, unknown>): Set<string> => {
    const tokens = new Set<string>();

    const directKeys = [
        "building_osm_id",
        "consumer_osm_id",
        "load_osm_id",
        "to_osm_id",
        "from_osm_id",
        "building_id",
        "consumer_id",
        "load_id",
    ];
    for (const key of directKeys) {
        addTokenVariants(tokens, props[key]);
    }

    const busKeys = ["to_bus", "from_bus", "to_node", "from_node"];
    for (const key of busKeys) {
        const raw = props[key];
        if (raw === undefined || raw === null) continue;
        const text = String(raw).trim();
        if (!text) continue;

        const idMatch = text.match(/ID[/:_-]?(-?\d+)/i);
        if (idMatch) {
            addTokenVariants(tokens, idMatch[1]);
        }

        const customMatch = text.match(/custom[/:_-]?(\d+)/i);
        if (customMatch) {
            addTokenVariants(tokens, `custom_${customMatch[1]}`);
        }
    }

    return tokens;
};

const buildLineDedupKey = (feature: any, props: Record<string, unknown>): string => {
    const lineID = props.line_id ?? props.lines_result_id ?? props.id;
    if (lineID !== undefined && lineID !== null && String(lineID).trim() !== "") {
        return `id:${String(lineID).trim()}`;
    }

    const gridID = extractLineGridId(props);
    const fromBus = String(props.from_bus ?? props.from_node ?? "").trim();
    const toBus = String(props.to_bus ?? props.to_node ?? "").trim();
    const geometryKey = JSON.stringify(feature?.geometry?.coordinates ?? "");
    return `geo:${gridID ?? ""}|${fromBus}|${toBus}|${geometryKey}`;
};

export const normalizeGridLineAssignments = (data: PylovoGridData): PylovoGridData => {
    const lineFeatures = data.lines?.features;
    const buildingFeatures = data.buildings?.features;
    if (!Array.isArray(lineFeatures) || lineFeatures.length === 0) return data;
    if (!Array.isArray(buildingFeatures) || buildingFeatures.length === 0) return data;

    const gridsWithBuildings = new Set<number>();
    const buildingGridByToken = new Map<string, number>();

    for (const building of buildingFeatures as any[]) {
        const props = (building?.properties ?? {}) as Record<string, unknown>;
        const gridID = extractLineGridId(props);
        if (gridID === null) continue;
        gridsWithBuildings.add(gridID);

        const buildingTokens = new Set<string>();
        addTokenVariants(buildingTokens, props.osm_id);
        addTokenVariants(buildingTokens, props.building_osm_id);
        for (const token of buildingTokens) {
            if (!buildingGridByToken.has(token)) {
                buildingGridByToken.set(token, gridID);
            }
        }
    }

    if (gridsWithBuildings.size === 0) return data;

    const seenLineKeys = new Set<string>();
    const filteredLineFeatures: any[] = [];
    let removedCount = 0;

    for (const line of lineFeatures as any[]) {
        const props = (line?.properties ?? {}) as Record<string, unknown>;
        const lineGridID = extractLineGridId(props);

        if (lineGridID !== null && !gridsWithBuildings.has(lineGridID)) {
            removedCount++;
            continue;
        }

        if (lineGridID !== null) {
            const linkedTokens = extractLinkedBuildingTokensFromLine(props);
            if (linkedTokens.size > 0) {
                let hasLinkedBuilding = false;
                let matchesAssignedGrid = false;
                for (const token of linkedTokens) {
                    const buildingGridID = buildingGridByToken.get(token);
                    if (buildingGridID === undefined) continue;
                    hasLinkedBuilding = true;
                    if (buildingGridID === lineGridID) {
                        matchesAssignedGrid = true;
                        break;
                    }
                }
                if (hasLinkedBuilding && !matchesAssignedGrid) {
                    removedCount++;
                    continue;
                }
            }
        }

        const dedupKey = buildLineDedupKey(line, props);
        if (seenLineKeys.has(dedupKey)) {
            removedCount++;
            continue;
        }
        seenLineKeys.add(dedupKey);
        filteredLineFeatures.push(line);
    }

    if (removedCount === 0) return data;

    return {
        ...data,
        lines: {
            ...(data.lines ?? { type: "FeatureCollection" }),
            features: filteredLineFeatures,
        },
    };
};

export const setFeatureColorIndex = (feature: Feature<Geometry>, colorMap: Map<number, number>): void => {
    const tID = feature.get("grid_result_id") ?? feature.get("transformer_id");
    if (tID === undefined || tID === null) return;
    const numID = typeof tID === "number" ? tID : Number.parseInt(String(tID), 10);
    const colorIndex = colorMap.get(numID);
    if (colorIndex !== undefined) feature.set("_color_index", colorIndex);
};
