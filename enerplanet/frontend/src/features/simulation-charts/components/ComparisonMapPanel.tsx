import { FC, useEffect, useRef, useCallback } from 'react';
import { Map as OlMap, View } from 'ol';
import TileLayer from 'ol/layer/Tile';
import VectorLayer from 'ol/layer/Vector';
import VectorSource from 'ol/source/Vector';
import Feature from 'ol/Feature';
import Polygon from 'ol/geom/Polygon';
import type { Geometry } from 'ol/geom';
import { fromLonLat } from 'ol/proj';
import { Style, Fill, Stroke } from 'ol/style';
import { defaults as defaultControls } from 'ol/control';
import OSM from 'ol/source/OSM';
import { Model } from '@/features/model-dashboard/services/modelService';
import { loadGridLayers, removeGridLayers, fitToFeatures } from '@/features/configurator/utils/gridLayerUtils';
import { Map as MapIcon, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { useTranslation } from '@spatialhub/i18n';

interface ComparisonMapPanelProps {
  model1: Model;
  model2: Model;
}

interface SingleMapProps {
  model: Model;
  label: string;
  color: string;
  accentClasses: { headerBg: string; headerText: string };
  mapId: string;
}

const SingleMap: FC<SingleMapProps> = ({ model, label, color, accentClasses, mapId }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<OlMap | null>(null);
  const layersRef = useRef<VectorLayer<VectorSource>[]>([]);
  const polygonLayerRef = useRef<VectorLayer<VectorSource> | null>(null);
  const { t } = useTranslation();

  // Initialize map
  useEffect(() => {
    if (!mapRef.current || mapInstanceRef.current) return;

    const olMap = new OlMap({
      target: mapRef.current,
      layers: [
        new TileLayer({
          source: new OSM(),
        }),
      ],
      view: new View({
        center: fromLonLat([10, 51]), // Default Germany center
        zoom: 6,
        maxZoom: 20,
        minZoom: 3,
      }),
      controls: defaultControls({
        zoom: false,
        attribution: false,
        rotate: false,
      }),
    });

    mapInstanceRef.current = olMap;

    // Cleanup on unmount
    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.setTarget();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  // Load model data onto map
  useEffect(() => {
    const map = mapInstanceRef.current;
    if (!map || !model?.config) return;

    // Clear existing layers
    removeGridLayers(map, layersRef.current);
    layersRef.current = [];
    if (polygonLayerRef.current) {
      map.removeLayer(polygonLayerRef.current);
      polygonLayerRef.current = null;
    }

    const allFeatures: Feature<Geometry>[] = [];

    // Add polygon layer (model boundary)
    const coordinates = model.coordinates as { coordinates?: number[][][][] } | undefined;
    if (coordinates?.coordinates?.length) {
      const polygonSource = new VectorSource();
      coordinates.coordinates.forEach((polygonCoords) => {
        if (polygonCoords.length > 0 && polygonCoords[0].length > 0) {
          const projectedCoords = polygonCoords[0].map((coord: number[]) =>
            fromLonLat([coord[0], coord[1]])
          );
          const feature = new Feature({ geometry: new Polygon([projectedCoords]) });
          feature.setStyle(new Style({
            fill: new Fill({ color: `${color}20` }), // 20 = 12% opacity in hex
            stroke: new Stroke({ color, width: 2, lineDash: [8, 4] }),
          }));
          polygonSource.addFeature(feature);
          allFeatures.push(feature);
        }
      });
      const polygonLayer = new VectorLayer({ source: polygonSource, zIndex: 1 });
      map.addLayer(polygonLayer);
      polygonLayerRef.current = polygonLayer;
    }

    // Load grid layers (buildings, transformers, lines)
    const config = model.config as Record<string, unknown> | undefined;
    if (config) {
      const { layers, allFeatures: gridFeatures } = loadGridLayers(map, config);
      layersRef.current = layers;
      allFeatures.push(...gridFeatures);
    }

    // Fit view to features
    if (allFeatures.length > 0) {
      setTimeout(() => {
        fitToFeatures(map, allFeatures, { duration: 500, padding: [30, 30, 30, 30] });
      }, 100);
    }

    return () => {
      removeGridLayers(map, layersRef.current);
      layersRef.current = [];
      if (polygonLayerRef.current && map) {
        map.removeLayer(polygonLayerRef.current);
        polygonLayerRef.current = null;
      }
    };
  }, [model, color]);

  const handleZoomIn = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const view = map.getView();
    const zoom = view.getZoom();
    if (zoom !== undefined) {
      view.animate({ zoom: zoom + 1, duration: 250 });
    }
  }, []);

  const handleZoomOut = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map) return;
    const view = map.getView();
    const zoom = view.getZoom();
    if (zoom !== undefined) {
      view.animate({ zoom: zoom - 1, duration: 250 });
    }
  }, []);

  const handleFitExtent = useCallback(() => {
    const map = mapInstanceRef.current;
    if (!map) return;

    const allFeatures: Feature<Geometry>[] = [];
    layersRef.current.forEach(layer => {
      const source = layer.getSource();
      if (source) {
        allFeatures.push(...source.getFeatures());
      }
    });
    if (polygonLayerRef.current) {
      const source = polygonLayerRef.current.getSource();
      if (source) {
        allFeatures.push(...source.getFeatures());
      }
    }

    if (allFeatures.length > 0) {
      fitToFeatures(map, allFeatures, { duration: 500, padding: [30, 30, 30, 30] });
    }
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Colored header bar */}
      <div className={`flex items-center justify-between px-4 py-2.5 ${accentClasses.headerBg}`}>
        <div className="flex items-center gap-2">
          <MapIcon className={`w-4 h-4 ${accentClasses.headerText}`} />
          <span className={`text-sm font-semibold ${accentClasses.headerText}`}>{label}</span>
        </div>
        <span className={`text-xs truncate max-w-[180px] ${accentClasses.headerText} opacity-80`}>
          {model.title}
        </span>
      </div>

      {/* Map Container */}
      <div className="flex-1 relative">
        <div ref={mapRef} id={mapId} className="w-full h-full" />

        {/* Map Controls — rounded with hover effects */}
        <div className="absolute bottom-3 right-3 flex flex-col gap-1.5 z-10">
          <button
            onClick={handleZoomIn}
            className="p-2 bg-card/90 backdrop-blur-sm border border-border rounded-lg shadow-sm hover:bg-card hover:shadow-md transition-all"
            title={t('map.zoomIn')}
          >
            <ZoomIn className="w-4 h-4 text-foreground" />
          </button>
          <button
            onClick={handleZoomOut}
            className="p-2 bg-card/90 backdrop-blur-sm border border-border rounded-lg shadow-sm hover:bg-card hover:shadow-md transition-all"
            title={t('map.zoomOut')}
          >
            <ZoomOut className="w-4 h-4 text-foreground" />
          </button>
          <button
            onClick={handleFitExtent}
            className="p-2 bg-card/90 backdrop-blur-sm border border-border rounded-lg shadow-sm hover:bg-card hover:shadow-md transition-all"
            title={t('map.fitToExtent')}
          >
            <Maximize2 className="w-4 h-4 text-foreground" />
          </button>
        </div>

        {/* Frosted-glass region badge */}
        {model.region && (
          <div className="absolute top-3 left-3 px-3 py-1.5 bg-card/80 backdrop-blur-md border border-border/50 rounded-lg text-xs font-medium text-foreground shadow-sm z-10">
            {model.region}
          </div>
        )}
      </div>
    </div>
  );
};

export const ComparisonMapPanel: FC<ComparisonMapPanelProps> = ({ model1, model2 }) => {
  const { t } = useTranslation();

  return (
    <div className="bg-card rounded-xl border border-border shadow-sm overflow-hidden">
      {/* Gradient section header */}
      <div className="bg-muted px-4 py-2 text-center text-xs font-semibold text-foreground sm:text-sm border-b border-border">
        {t('simulationComparison.locationMaps')}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 divide-y lg:divide-y-0 lg:divide-x divide-border" style={{ height: '450px' }}>
        <SingleMap
          model={model1}
          label={t('simulationComparison.baseline')}
          color="#3B82F6"
          accentClasses={{
            headerBg: 'bg-blue-500/10 border-b border-blue-200 dark:border-blue-800',
            headerText: 'text-blue-700 dark:text-blue-300',
          }}
          mapId="comparison-map-baseline"
        />
        <SingleMap
          model={model2}
          label={t('simulationComparison.comparison')}
          color="#F59E0B"
          accentClasses={{
            headerBg: 'bg-amber-500/10 border-b border-amber-200 dark:border-amber-800',
            headerText: 'text-amber-700 dark:text-amber-300',
          }}
          mapId="comparison-map-comparison"
        />
      </div>
    </div>
  );
};
