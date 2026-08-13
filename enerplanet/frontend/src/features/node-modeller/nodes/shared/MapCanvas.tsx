/**
 * Minimal OpenLayers canvas owned by node-modeller (Plan P3, isolation rule).
 *
 * Supports polygon drawing; reports the drawn polygons as a GeoJSON
 * FeatureCollection via onPolygonsChange. Deliberately small — richer map
 * interactions (building selection etc.) build on this in P4.
 */
import { Feature, Map as OLMap, View } from "ol";
import Draw from "ol/interaction/Draw";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import { fromLonLat } from "ol/proj";
import OSM from "ol/source/OSM";
import VectorSource from "ol/source/Vector";
import GeoJSON from "ol/format/GeoJSON";
import "ol/ol.css";
import { useEffect, useRef } from "react";

export interface MapCanvasProps {
  /** Called whenever the drawn polygon set changes. */
  onPolygonsChange: (polygons: GeoJSON.FeatureCollection) => void;
  /** Features to display read-only (e.g. generated buildings). */
  displayFeatures?: GeoJSON.FeatureCollection;
  className?: string;
}

const geojson = new GeoJSON();

export function MapCanvas({ onPolygonsChange, displayFeatures, className }: MapCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const drawSourceRef = useRef(new VectorSource());
  const displaySourceRef = useRef(new VectorSource());
  const callbackRef = useRef(onPolygonsChange);
  callbackRef.current = onPolygonsChange;

  useEffect(() => {
    if (!containerRef.current) return;
    const drawSource = drawSourceRef.current;
    const map = new OLMap({
      target: containerRef.current,
      layers: [
        new TileLayer({ source: new OSM() }),
        new VectorLayer({ source: displaySourceRef.current }),
        new VectorLayer({ source: drawSource }),
      ],
      view: new View({ center: fromLonLat([10.45, 51.16]), zoom: 6 }), // Germany default
    });

    const draw = new Draw({ source: drawSource, type: "Polygon" });
    map.addInteraction(draw);

    const emit = () => {
      const fc = geojson.writeFeaturesObject(drawSource.getFeatures(), {
        dataProjection: "EPSG:4326",
        featureProjection: "EPSG:3857",
      });
      callbackRef.current(fc as GeoJSON.FeatureCollection);
    };
    draw.on("drawend", emit);

    return () => map.setTarget(undefined);
  }, []);

  // render display features (buildings etc.) whenever they change
  useEffect(() => {
    const source = displaySourceRef.current;
    source.clear();
    if (!displayFeatures || displayFeatures.features.length === 0) return;
    source.addFeatures(
      geojson.readFeatures(displayFeatures, {
        dataProjection: "EPSG:4326",
        featureProjection: "EPSG:3857",
      })
    );
  }, [displayFeatures]);

  return (
    <div className={`relative ${className ?? ""}`}>
      <div ref={containerRef} className="h-full w-full" />
      <button
        type="button"
        onClick={() => {
          drawSourceRef.current.clear();
          callbackRef.current({ type: "FeatureCollection", features: [] });
        }}
        className="absolute right-2 top-2 rounded-md border bg-background/95 px-2 py-1 text-xs shadow"
      >
        Clear areas
      </button>
    </div>
  );
}

export type { Feature };
