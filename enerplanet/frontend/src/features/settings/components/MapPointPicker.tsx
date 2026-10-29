import React, { useEffect, useRef } from "react";
import { Map as OlMap, View } from "ol";
import Feature from "ol/Feature";
import Point from "ol/geom/Point";
import TileLayer from "ol/layer/Tile";
import VectorLayer from "ol/layer/Vector";
import OSM from "ol/source/OSM";
import VectorSource from "ol/source/Vector";
import { Circle, Fill, Stroke, Style } from "ol/style";
import { fromLonLat, toLonLat } from "ol/proj";
import { defaults as defaultControls } from "ol/control";

interface MapPointPickerProps {
  latitude: number;
  longitude: number;
  zoom?: number;
  /** Called with the clicked point and the map's zoom at the time of the click. */
  onPick: (latitude: number, longitude: number, zoom: number) => void;
}

const MARKER_STYLE = new Style({
  image: new Circle({ radius: 7, fill: new Fill({ color: "#1f8f4e" }), stroke: new Stroke({ color: "#ffffff", width: 2 }) }),
});

/** A small map that marks a point and reports the point the user clicks. */
export const MapPointPicker: React.FC<MapPointPickerProps> = ({ latitude, longitude, zoom = 12, onPick }) => {
  const targetRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<OlMap | null>(null);
  const markerRef = useRef(new Feature(new Point(fromLonLat([longitude, latitude]))));
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    if (!targetRef.current) return;
    markerRef.current.setStyle(MARKER_STYLE);
    const map = new OlMap({
      target: targetRef.current,
      layers: [
        new TileLayer({ source: new OSM() }),
        new VectorLayer({ source: new VectorSource({ features: [markerRef.current] }) }),
      ],
      view: new View({ center: fromLonLat([longitude, latitude]), zoom, minZoom: 3, maxZoom: 18 }),
      controls: defaultControls({ rotate: false }),
    });
    map.on("singleclick", (e) => {
      const [lon, lat] = toLonLat(e.coordinate);
      onPickRef.current(lat, lon, Math.round(map.getView().getZoom() ?? zoom));
    });
    mapRef.current = map;
    return () => {
      map.setTarget(undefined);
      mapRef.current = null;
    };
    // The map is created once; the effect below follows later points.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const point = fromLonLat([longitude, latitude]);
    markerRef.current.setGeometry(new Point(point));
    mapRef.current?.getView().animate({ center: point, duration: 250 });
  }, [latitude, longitude]);

  return <div ref={targetRef} className="h-56 w-full overflow-hidden rounded-lg border border-border" />;
};
