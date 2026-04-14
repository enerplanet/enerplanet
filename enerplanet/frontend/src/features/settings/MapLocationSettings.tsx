import React from 'react';
import { useMapLocationStore } from '@/features/interactive-map/store/map-location';
import { GeocodingResult } from '@/features/interactive-map/services/geocoding';
import { updateMapToSavedLocation } from '@/features/interactive-map/store/map-store';
import { Loader2 } from 'lucide-react';
import { LocationSearch } from './components/LocationSearch';
import { SavedLocationsList } from './components/SavedLocationsList';
import { useTranslation } from '@spatialhub/i18n';

const MapLocationSettings: React.FC = () => {
  const { t } = useTranslation();
  const { 
    location,
    savedLocations,
    setLocation,
    addSavedLocation,
    removeSavedLocation,
    clearSavedLocations,
    isLoading: storeLoading,
    syncError
  } = useMapLocationStore();

  const handleSelectResult = (r: GeocodingResult) => {
    const loc = {
      id: r.id.toString(),
      name: r.name || `${r.latitude.toFixed(3)}, ${r.longitude.toFixed(3)}`,
      latitude: r.latitude,
      longitude: r.longitude,
      zoom: 12,
      source: 'geocoded' as const
    };
    addSavedLocation(loc);
    updateMapToSavedLocation(loc);
  };

  const handleRemoveLocation = (id: string) => {
    removeSavedLocation(id);
    setTimeout(() => updateMapToSavedLocation(), 100);
  };

  const handleClearAll = () => {
    clearSavedLocations();
    setTimeout(() => updateMapToSavedLocation(), 100);
  };

  return (
    <div className="space-y-2">
      {/* Status */}
      {storeLoading && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground bg-muted px-3 py-2 rounded-lg">
          <Loader2 className="w-3.5 h-3.5 animate-spin" />
          <span>{t('settings.mapLocation.syncing')}</span>
        </div>
      )}

      {syncError && (
        <div className="text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-lg">
          {syncError}
        </div>
      )}

      {/* Search */}
      <LocationSearch
        onSelect={handleSelectResult}
        isLocationAdded={(r) => savedLocations.some(loc => loc.id === r.id.toString())}
        placeholder={t('settings.mapLocation.searchPlaceholder')}
      />

      {/* Current Location */}
      <div className="text-xs text-muted-foreground">
        {t('settings.mapLocation.current')}: <span className="font-medium text-foreground">{location?.name || t('settings.mapLocation.noLocation')}</span>
      </div>

      {/* Saved Locations */}
      <SavedLocationsList
        locations={savedLocations}
        currentLocationId={location?.id}
        onSelect={(loc) => { setLocation(loc as any); updateMapToSavedLocation(loc as any); }}
        onRemove={handleRemoveLocation}
        onClearAll={handleClearAll}
        title={t('settings.mapLocation.savedLocations')}
      />

      {/* Footer */}
      <div className="text-xs text-muted-foreground pt-2 border-t border-border">
        {t('settings.mapLocation.syncNote')}
      </div>
    </div>
  );
};

export default MapLocationSettings;

