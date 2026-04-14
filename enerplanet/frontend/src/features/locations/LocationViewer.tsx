import { useState, useEffect, type FC } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Edit, MapPin, Globe, Lock, Loader2 } from 'lucide-react';
import { MapContainer } from '@/components/shared/MapContainer';
import { useMapStore } from '@/features/interactive-map/store/map-store';
import { PolygonDrawer } from '@/features/polygon-drawer';
import { customLocationService, type CustomLocation } from '@/features/locations/services/customLocationService';
import { formatArea, useZoomToCoordinates, useClearOverlays } from '@/features/locations/utils/locationUtils';

const LocationViewer: FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { map, clearOverlayLayers, setFireRiskOverlay } = useMapStore();

  const [location, setLocation] = useState<CustomLocation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [polygonCoordinates, setPolygonCoordinates] = useState<[number, number][]>([]);

  const zoomToCoordinates = useZoomToCoordinates(map);
  useClearOverlays(clearOverlayLayers, setFireRiskOverlay);

  useEffect(() => {
    if (id) {
      setIsLoading(true);
      customLocationService.getLocation(Number.parseInt(id))
        .then((loc) => {
          setLocation(loc);
          if (loc.geometry_area?.coordinates) {
            const coords = loc.geometry_area.coordinates[0] as [number, number][];
            setPolygonCoordinates(coords);
            setTimeout(() => zoomToCoordinates(coords), 300);
          }
        })
        .catch(() => {
          navigate('/app/locations');
        })
        .finally(() => setIsLoading(false));
    }
  }, [id, navigate, zoomToCoordinates]);

  if (isLoading) {
    return (
      <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
        <div className="bg-background rounded-lg shadow-xl p-8 max-w-md mx-4 border border-border">
          <div className="flex flex-col items-center space-y-4">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            <div className="text-lg font-medium text-foreground">Loading Location</div>
          </div>
        </div>
      </div>
    );
  }

  if (!location) {
    return null;
  }

  return (
    <>
    <MapContainer
      modal={false}
      topBar={null}
      sidebar={
        <div className="relative h-full w-80 border-l border-border bg-background dark:bg-gray-800 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between px-3 pt-4 pb-2 border-b border-border">
            <div className="flex items-center gap-2">
              <button
                onClick={() => navigate('/app/locations')}
                className="p-1.5 rounded-lg hover:bg-muted transition-colors"
              >
                <ArrowLeft className="w-4 h-4 text-muted-foreground" />
              </button>
              <h3 className="text-base font-semibold text-foreground">View Location</h3>
            </div>
            <button
              onClick={() => navigate(`/app/locations/edit/${id}`)}
              className="p-1.5 rounded-lg hover:bg-muted transition-colors"
              title="Edit location"
            >
              <Edit className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto pb-4 space-y-3 px-3 pt-3">
            {/* Title */}
            <div className="flex items-center gap-2">
              <div className="p-2 bg-muted rounded-lg">
                <MapPin className="w-5 h-5 text-muted-foreground" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-foreground">{location.title}</h2>
                <p className="text-xs text-muted-foreground">ID: {location.osm_id}</p>
              </div>
            </div>

            {/* Classification */}
            <div className="bg-muted/50 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Type</span>
                <span className="text-sm font-medium text-foreground capitalize">{location.f_class}</span>
              </div>
            </div>

            {/* Stats */}
            <div className="bg-muted/50 rounded-lg p-3 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Area</span>
                <span className="text-sm font-medium text-foreground">{formatArea(location.area)}</span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted-foreground">Energy Demand</span>
                <span className="text-sm font-medium text-foreground">{location.demand_energy.toLocaleString()} kWh/yr</span>
              </div>
            </div>

            {/* Visibility */}
            <div className="flex items-center gap-2 p-3 bg-muted/50 rounded-lg">
              {location.is_public ? (
                <>
                  <Globe className="w-4 h-4 text-green-600" />
                  <span className="text-sm font-medium text-green-600">Public</span>
                </>
              ) : (
                <>
                  <Lock className="w-4 h-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-muted-foreground">Private</span>
                </>
              )}
            </div>

            {/* Tags */}
            {location.tags && location.tags.length > 0 && (
              <div>
                <span className="text-xs text-muted-foreground mb-2 block">Tags</span>
                <div className="flex flex-wrap gap-1.5">
                  {location.tags.map((tag) => (
                    <span
                      key={tag}
                      className="px-2 py-0.5 bg-muted rounded text-xs text-foreground"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Timestamps */}
            <div className="text-[10px] text-muted-foreground space-y-1 pt-2 border-t border-border">
              <div>Created: {new Date(location.created_at).toLocaleString()}</div>
              <div>Updated: {new Date(location.updated_at).toLocaleString()}</div>
            </div>
          </div>

          {/* Footer */}
          <div className="border-t border-border p-3 bg-background dark:bg-gray-800">
            <button
              onClick={() => navigate(`/app/locations/edit/${id}`)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-all"
            >
              <Edit className="w-4 h-4" />
              Edit Location
            </button>
          </div>
        </div>
      }
      showSidebar={true}
    />

    {/* Display the polygon on the map */}
    {polygonCoordinates.length > 0 && (
      <PolygonDrawer
        map={map}
        onPolygonDrawn={() => {}}
        onDrawingChange={() => {}}
        allowMultiple={false}
        initialPolygons={[polygonCoordinates]}
        disableAfterDraw={true}
        readOnly={true}
      />
    )}
    </>
  );
};

export default LocationViewer;
