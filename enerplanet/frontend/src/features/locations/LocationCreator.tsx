import { useState, useCallback, useEffect, type FC } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useDocumentTitle } from '@/hooks/use-document-title';
import { ArrowLeft, ChevronLeft, ChevronRight, Loader2, Save } from 'lucide-react';
import { MapContainer } from '@/components/shared/MapContainer';
import { useMapStore } from '@/features/interactive-map/store/map-store';
import { PolygonDrawer } from '@/features/polygon-drawer';
import { useCustomLocationStore } from '@/features/locations/store/custom-location-store';
import { customLocationService } from '@/features/locations/services/customLocationService';
import { useNotification } from '@/features/notifications/hooks/useNotification';
import Notification from '@/components/ui/Notification';
import { RegionSelector, type AvailableRegion } from '@/features/configurator/region-selector/components/RegionSelector';
import { pylovoService } from '@/features/configurator/services/pylovoService';
import { loadAvailableBoundaryLayers, highlightSelectedRegionBoundary } from '@/features/configurator/utils/gridLayerUtils';
import { transformExtent } from 'ol/proj';
import GeoJSON from 'ol/format/GeoJSON';
import {
  useZoomToCoordinates,
  useClearOverlays,
} from '@/features/locations/utils/locationUtils';

import StepIndicator from './components/StepIndicator';
import Step1Metadata from './components/Step1Metadata';
import Step2Area from './components/Step2Area';
import Step3BuildingProperties from './components/Step3BuildingProperties';
import type { BuildingProperties } from './components/Step3BuildingProperties';
import Step4DemandSave from './components/Step4DemandSave';

const STEPS = [
  { id: 'metadata', label: 'Details' },
  { id: 'area', label: 'Area' },
  { id: 'properties', label: 'Building' },
  { id: 'demand', label: 'Save' },
];

interface LocationCreatorProps {
  editMode?: boolean;
}

const LocationCreator: FC<LocationCreatorProps> = ({ editMode = false }) => {
  useDocumentTitle(editMode ? 'Edit Location' : 'Create Location', ' | EnerPlanET');
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const { map, clearOverlayLayers, setFireRiskOverlay } = useMapStore();
  const { createLocation, updateLocation } = useCustomLocationStore();
  const { notification, showSuccess, showError, hide } = useNotification();

  // Wizard state
  const [currentStep, setCurrentStep] = useState(0);

  // Step 1: Metadata
  const [title, setTitle] = useState('');
  const [isPublic, setIsPublic] = useState(false);
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState('');

  // Step 2: Area
  const [polygonCoordinates, setPolygonCoordinates] = useState<[number, number][]>([]);
  const [area, setArea] = useState(0);
  const [clearTrigger, setClearTrigger] = useState(0);

  // Step 3: Building properties
  const [buildingProps, setBuildingProps] = useState<BuildingProperties>({
    fClass: 'house',
    energyLabel: '',
    height: '',
    floors: '',
    constructionYear: '',
    heatingType: '',
    hotWaterElectric: null,
    areaModifier: 0,
  });

  // Step 4: Demand
  const [demandEnergy, setDemandEnergy] = useState(3500);
  const [peakLoad, setPeakLoad] = useState(0);

  // Loading state
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingExisting, setIsLoadingExisting] = useState(editMode);

  // Region selector state
  const [availableRegions, setAvailableRegions] = useState<AvailableRegion[]>([]);

  // Shared hooks
  const zoomToCoordinates = useZoomToCoordinates(map);
  useClearOverlays(clearOverlayLayers, setFireRiskOverlay);

  // Fetch available regions
  useEffect(() => {
    if (!map) return;
    pylovoService.getAvailableRegions()
      .then((response) => {
        if (response.status === 'success' && response.regions?.length) {
          setAvailableRegions(
            response.regions
              .filter((r) => r.region?.name)
              .map((r) => ({
                name: r.region!.name,
                gridCount: r.grid_count,
                country: r.region?.country,
                bbox: r.bbox,
              }))
          );
          const boundaryRegions = response.regions
            .filter((r) => r.boundary && r.region?.name)
            .map((r) => ({ boundary: r.boundary!, name: r.region!.name }));
          if (boundaryRegions.length) {
            loadAvailableBoundaryLayers(map, boundaryRegions);
          }
        }
      })
      .catch(() => {});
  }, [map]);

  const handleRegionSelect = useCallback((region: AvailableRegion) => {
    if (!map || !region.bbox) return;
    const { west, south, east, north } = region.bbox;
    const extent = transformExtent([west, south, east, north], 'EPSG:4326', 'EPSG:3857');
    map.getView().fit(extent, {
      padding: [60, 60, 60, 60],
      duration: 1500,
      maxZoom: 14,
      easing: (t: number) => t * (2 - t),
    });
    highlightSelectedRegionBoundary(map, region.name);
  }, [map]);

  // Load existing location
  useEffect(() => {
    if (editMode && id) {
      setIsLoadingExisting(true);
      customLocationService.getLocation(Number.parseInt(id))
        .then((location) => {
          setTitle(location.title);
          setBuildingProps((prev) => ({ ...prev, fClass: location.f_class || 'house' }));
          setDemandEnergy(location.demand_energy);
          setIsPublic(location.is_public);
          setTags(location.tags || []);
          setArea(location.area);
          if (location.geometry_area?.coordinates) {
            const coords = location.geometry_area.coordinates[0] as [number, number][];
            setPolygonCoordinates(coords);
            setTimeout(() => zoomToCoordinates(coords, { duration: 1200, maxZoom: 18 }), 300);
          }
        })
        .catch(() => {
          showError('Failed to load location');
          navigate('/app/locations');
        })
        .finally(() => setIsLoadingExisting(false));
    }
  }, [editMode, id, navigate, showError, zoomToCoordinates]);

  // Handle polygon drawn
  const handlePolygonDrawn = useCallback((coordinates: [number, number][]) => {
    setPolygonCoordinates(coordinates);
    if (coordinates.length >= 3) {
      const format = new GeoJSON();
      try {
        const featureResult = format.readFeature(
          { type: 'Polygon', coordinates: [coordinates] },
          { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:4326' },
        );
        const singleFeature = Array.isArray(featureResult) ? featureResult[0] : featureResult;
        const geom = singleFeature?.getGeometry();
        if (geom) {
          const ext = geom.getExtent();
          const calculatedArea = Math.abs(
            (ext[2] - ext[0]) * (ext[3] - ext[1]) * 111320 * 111320 *
            Math.cos(((ext[1] + ext[3]) / 2) * Math.PI / 180),
          );
          setArea(calculatedArea);
        }
      } catch { setArea(0); }
    }
  }, []);

  const handleClearPolygon = useCallback(() => {
    setPolygonCoordinates([]);
    setArea(0);
    setClearTrigger((prev) => prev + 1);
  }, []);

  // Save handler
  const handleSave = useCallback(async () => {
    if (!title.trim()) { showError('Please enter a title'); return; }
    if (polygonCoordinates.length < 3) { showError('Please draw an area on the map'); return; }

    setIsLoading(true);
    try {
      const avgLon = polygonCoordinates.reduce((s, c) => s + c[0], 0) / polygonCoordinates.length;
      const avgLat = polygonCoordinates.reduce((s, c) => s + c[1], 0) / polygonCoordinates.length;

      const locationData = {
        title: title.trim(),
        f_class: buildingProps.fClass.trim(),
        area: area * (1 + buildingProps.areaModifier / 100),
        demand_energy: demandEnergy,
        geometry: { type: 'Point' as const, coordinates: [avgLon, avgLat] },
        geometry_area: { type: 'Polygon' as const, coordinates: [polygonCoordinates] },
        tags,
        is_public: isPublic,
      };

      if (editMode && id) {
        await updateLocation(Number.parseInt(id), locationData);
        showSuccess('Location updated successfully');
      } else {
        await createLocation(locationData);
        showSuccess('Location created successfully');
      }
      navigate('/app/locations');
    } catch {
      showError(editMode ? 'Failed to update location' : 'Failed to create location');
    } finally {
      setIsLoading(false);
    }
  }, [
    title, polygonCoordinates, area, buildingProps, demandEnergy, tags, isPublic,
    editMode, id, createLocation, updateLocation, navigate, showSuccess, showError,
  ]);

  // Step validation
  const canProceed = (step: number) => {
    if (step === 0) return !!title.trim();
    if (step === 1) return polygonCoordinates.length >= 3;
    if (step === 2) return !!buildingProps.fClass;
    return true;
  };

  if (isLoadingExisting) {
    return (
      <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center">
        <div className="bg-card/95 backdrop-blur-md rounded-xl shadow-xl p-8 max-w-md mx-4 border border-border">
          <div className="flex flex-col items-center space-y-4">
            <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            <div className="text-lg font-medium text-foreground">Loading Location</div>
          </div>
        </div>
      </div>
    );
  }

  const stepDescriptions = [
    'Set up your location name and visibility',
    'Draw the area boundary on the map',
    'Configure building characteristics',
    'Review and save your location',
  ];

  return (
    <>
      <Notification
        isOpen={notification.open}
        message={notification.message}
        severity={notification.severity}
        onClose={hide}
      />

      <MapContainer
        modal={false}
        topBar={
          availableRegions.length > 0 ? (
            <div className="bg-background dark:bg-gray-800 border-b border-border px-2 py-1.5 flex items-center">
              <RegionSelector regions={availableRegions} onRegionSelect={handleRegionSelect} />
            </div>
          ) : null
        }
        showSidebar={false}
        mapOverlays={
          <div className="absolute left-4 top-4 bottom-4 w-[340px] z-30 flex flex-col pointer-events-auto">
            <div className="bg-card/95 backdrop-blur-md border border-border rounded-xl shadow-xl flex flex-col max-h-full overflow-hidden">
              {/* Header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-border/50">
                <button
                  onClick={() => navigate('/app/locations')}
                  className="p-1.5 rounded-lg hover:bg-muted transition-colors"
                >
                  <ArrowLeft className="w-4 h-4 text-muted-foreground" />
                </button>
                <div className="flex-1 min-w-0">
                  <h3 className="text-sm font-semibold text-foreground truncate">
                    {editMode ? 'Edit Location' : 'New Location'}
                  </h3>
                  <p className="text-[10px] text-muted-foreground mt-0.5">
                    {stepDescriptions[currentStep]}
                  </p>
                </div>
              </div>

              {/* Step Indicator */}
              <div className="px-5 py-3 border-b border-border/50">
                <StepIndicator steps={STEPS} currentStep={currentStep} />
              </div>

              {/* Step Content */}
              <div className="flex-1 overflow-y-auto px-4 py-4 min-h-0">
                {currentStep === 0 && (
                  <Step1Metadata
                    title={title} setTitle={setTitle}
                    isPublic={isPublic} setIsPublic={setIsPublic}
                    tags={tags} setTags={setTags}
                    tagInput={tagInput} setTagInput={setTagInput}
                  />
                )}
                {currentStep === 1 && (
                  <Step2Area
                    polygonCoordinates={polygonCoordinates}
                    area={area}
                    onClear={handleClearPolygon}
                  />
                )}
                {currentStep === 2 && (
                  <Step3BuildingProperties
                    properties={buildingProps}
                    onChange={setBuildingProps}
                  />
                )}
                {currentStep === 3 && (
                  <Step4DemandSave
                    demandEnergy={demandEnergy} setDemandEnergy={setDemandEnergy}
                    peakLoad={peakLoad} setPeakLoad={setPeakLoad}
                    title={title} area={area} isPublic={isPublic} tags={tags}
                    properties={buildingProps} polygonCoordinates={polygonCoordinates}
                    isLoading={isLoading} onSave={handleSave} editMode={editMode}
                  />
                )}
              </div>

              {/* Navigation Footer */}
              <div className="border-t border-border/50 px-4 py-3 flex items-center justify-between gap-2">
                <button
                  onClick={() => setCurrentStep((s) => Math.max(0, s - 1))}
                  disabled={currentStep === 0}
                  className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-border rounded-lg hover:bg-muted transition-colors disabled:opacity-30 disabled:pointer-events-none"
                >
                  <ChevronLeft className="w-3.5 h-3.5" /> Back
                </button>

                <div className="flex items-center gap-1">
                  {STEPS.map((_, i) => (
                    <div
                      key={i}
                      className={`h-1 rounded-full transition-all duration-300 ${
                        i === currentStep ? 'w-4 bg-primary' : 'w-1.5 bg-border'
                      }`}
                    />
                  ))}
                </div>

                {currentStep < 3 ? (
                  <button
                    onClick={() => setCurrentStep((s) => Math.min(STEPS.length - 1, s + 1))}
                    disabled={!canProceed(currentStep)}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  >
                    Next <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                ) : (
                  <button
                    onClick={handleSave}
                    disabled={isLoading || !title.trim() || polygonCoordinates.length < 3}
                    className="flex items-center gap-1.5 px-3 py-2 text-xs font-medium bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-colors disabled:opacity-30 disabled:pointer-events-none"
                  >
                    {isLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                    {editMode ? 'Update' : 'Save'}
                  </button>
                )}
              </div>
            </div>
          </div>
        }
      />

      <PolygonDrawer
        map={map}
        onPolygonDrawn={handlePolygonDrawn}
        allowMultiple={false}
        clearTrigger={clearTrigger}
        initialPolygons={editMode && polygonCoordinates.length > 0 ? [polygonCoordinates] : undefined}
        disableAfterDraw={true}
      />
    </>
  );
};

export default LocationCreator;
