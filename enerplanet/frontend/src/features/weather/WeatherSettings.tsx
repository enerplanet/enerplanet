import { type FC } from 'react';
import { useWeatherLocationStore } from '@/features/weather/store/weather-location';
import { GeocodingResult } from '@/features/interactive-map/services/geocoding';
import { Loader2 } from 'lucide-react';
import { LocationSearch } from '../settings/components/LocationSearch';
import { SavedLocationsList } from '../settings/components/SavedLocationsList';
import { useTranslation } from '@spatialhub/i18n';

const WeatherSettings: FC = () => {
  const { t } = useTranslation();
  const {
    location,
    customLocations,
    setLocation,
    addCustomLocation,
    removeCustomLocation,
    clearCustomLocations,
    isLoading: storeLoading,
    syncError,
  } = useWeatherLocationStore();

  const handleSelectResult = (r: GeocodingResult) => {
    const loc = {
      id: r.id || `geo-${r.latitude.toFixed(4)},${r.longitude.toFixed(4)}`,
      name: r.name || `${r.latitude.toFixed(3)}, ${r.longitude.toFixed(3)}`,
      latitude: r.latitude,
      longitude: r.longitude,
      source: 'geocoded' as const
    };
    addCustomLocation(loc);
  };

  return (
    <div className="space-y-2">
      {/* Status */}
      {storeLoading && (
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground bg-muted px-2 py-1 rounded">
          <Loader2 className="w-3 h-3 animate-spin" />
          <span>{t('weather.syncing')}</span>
        </div>
      )}

      {syncError && (
        <div className="text-[10px] text-destructive bg-destructive/10 px-2 py-1 rounded">
          {syncError}
        </div>
      )}

      {/* Search */}
      <LocationSearch
        onSelect={handleSelectResult}
        isLocationAdded={(r) => customLocations.some(loc => loc.id === r.id)}
        placeholder={t('weather.searchLocation')}
      />

      {/* Current Location */}
      <div className="text-[10px] text-muted-foreground">
        {t('weather.current')}: <span className="font-medium text-foreground">{location.name}</span>
      </div>

      {/* Saved Locations */}
      <SavedLocationsList
        locations={customLocations}
        currentLocationId={location.id}
        onSelect={(loc) => setLocation(loc as any)}
        onRemove={removeCustomLocation}
        onClearAll={clearCustomLocations}
        title={t('weather.yourLocations')}
      />
    </div>
  );
};

export default WeatherSettings;
