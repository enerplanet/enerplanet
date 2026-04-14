import type { Feature } from "ol";
import type { Geometry } from "ol/geom";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";

import { getFeatureFClasses } from "@/features/configurator/utils/fClassUtils";
import { extractTransformerId } from "@/features/configurator/hooks/useAreaSelect/helpers/gridAssignments";

interface ConnectedBuildingsInfo {
    count: number;
    types: string[];
}

export const collectBuildingsFromLayers = (layers: VectorLayer<VectorSource>[]): Feature<Geometry>[] => {
    const buildings: Feature<Geometry>[] = [];
    for (const layer of layers) {
        const source = layer.getSource();
        if (!source) continue;
        for (const feature of source.getFeatures()) {
            if (feature.get("feature_type") === "building") {
                buildings.push(feature);
            }
        }
    }
    return buildings;
};

export const findBuildingLayer = (layers: VectorLayer<VectorSource>[]): VectorLayer<VectorSource> | null => {
    return layers.find((layer) => {
        const source = layer.getSource();
        if (!source) return false;
        const features = source.getFeatures();
        return features.length > 0 && features[0].get("feature_type") === "building";
    }) || null;
};

export const countConnectedBuildings = (
    transformerID: number | null,
    layers: VectorLayer<VectorSource>[],
): ConnectedBuildingsInfo => {
    if (transformerID === null) return { count: 0, types: [] };

    const buildingLayer = findBuildingLayer(layers);
    if (!buildingLayer) return { count: 0, types: [] };

    const source = buildingLayer.getSource();
    if (!source) return { count: 0, types: [] };

    let count = 0;
    const types: string[] = [];

    for (const buildingFeature of source.getFeatures()) {
        const buildingGridID = buildingFeature.get("grid_result_id") ?? buildingFeature.get("transformer_id");
        if (buildingGridID === undefined || buildingGridID === null) continue;

        const buildingNumID = typeof buildingGridID === "number"
            ? buildingGridID
            : Number.parseInt(String(buildingGridID), 10);

        if (buildingNumID === transformerID) {
            count++;
            const fClasses = getFeatureFClasses(buildingFeature.getProperties() as Record<string, unknown>);
            for (const fClass of fClasses) {
                if (!types.includes(fClass)) {
                    types.push(fClass);
                }
            }
        }
    }

    return { count, types };
};

export const highlightConnectedBuildings = (
    buildingSource: VectorSource,
    transformerID: number,
    highlightedRef: { current: Feature<Geometry>[] },
    applyHighlight: (feature: Feature<Geometry>) => void,
): void => {
    for (const feature of buildingSource.getFeatures()) {
        const numID = extractTransformerId(feature.getProperties());
        if (numID === transformerID) {
            applyHighlight(feature);
            highlightedRef.current.push(feature);
        }
    }
};
