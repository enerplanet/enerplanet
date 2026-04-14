import { useEffect, useRef } from "react";
import type { Map as OLMap } from "ol";
import VectorLayer from "ol/layer/Vector";
import VectorSource from "ol/source/Vector";
import Feature from "ol/Feature";
import { LineString } from "ol/geom";
import { Style, Stroke } from "ol/style";

interface UseReassignmentLineOptions {
    map: OLMap | null;
    active: boolean;
    /** Building anchor in map projection coordinates (EPSG:3857) */
    buildingCoords: [number, number] | null;
}

/**
 * Manages a temporary dashed line from a building to the cursor
 * while the user is in reassignment mode.
 */
export function useReassignmentLine({ map, active, buildingCoords }: UseReassignmentLineOptions) {
    const layerRef = useRef<VectorLayer<VectorSource> | null>(null);
    const featureRef = useRef<Feature<LineString> | null>(null);
    const strokeRef = useRef<Stroke | null>(null);

    useEffect(() => {
        if (!map || !active || !buildingCoords) {
            // Cleanup any existing layer
            if (layerRef.current && map) {
                map.removeLayer(layerRef.current);
            }
            layerRef.current = null;
            featureRef.current = null;
            return;
        }

        // Create source, feature, layer
        const source = new VectorSource();
        const lineFeature = new Feature<LineString>({
            geometry: new LineString([buildingCoords, buildingCoords]),
        });

        const stroke = new Stroke({
            color: "rgba(59, 130, 246, 0.8)",
            width: 2,
            lineDash: [8, 6],
            lineDashOffset: 0,
            lineCap: "round",
        });
        strokeRef.current = stroke;

        lineFeature.setStyle(new Style({ stroke }));

        source.addFeature(lineFeature);

        const layer = new VectorLayer({
            source,
            zIndex: 9999,
        });

        map.addLayer(layer);
        layerRef.current = layer;
        featureRef.current = lineFeature;

        // Update endpoint on pointer move
        const onPointerMove = (evt: any) => {
            if (featureRef.current && buildingCoords) {
                const coord = evt.coordinate as [number, number];
                featureRef.current.getGeometry()?.setCoordinates([buildingCoords, coord]);
            }
        };

        // Animate dash offset so the line appears to flow toward cursor.
        let rafId: number | null = null;
        let dashOffset = 0;
        const animateDash = () => {
            if (strokeRef.current && featureRef.current) {
                dashOffset = (dashOffset - 0.8) % 14; // 14 = lineDash total (8 + 6)
                strokeRef.current.setLineDashOffset(dashOffset);
                featureRef.current.changed();
            }
            rafId = requestAnimationFrame(animateDash);
        };
        rafId = requestAnimationFrame(animateDash);

        map.on("pointermove", onPointerMove);

        return () => {
            if (rafId !== null) {
                cancelAnimationFrame(rafId);
            }
            map.un("pointermove", onPointerMove);
            if (layerRef.current) {
                map.removeLayer(layerRef.current);
            }
            layerRef.current = null;
            featureRef.current = null;
            strokeRef.current = null;
        };
    }, [map, active, buildingCoords]);
}
