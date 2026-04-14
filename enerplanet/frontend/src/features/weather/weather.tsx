import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Cloud, Sun, CloudRain, CloudSnow, Zap, Eye, AlertTriangle, Settings2, Droplets, Wind, MapPin, Thermometer, Search, Loader2, SunDim } from 'lucide-react';
import { weatherService } from '@/features/weather/services/weather';
import { CurrentWeatherData } from '@/features/weather/types';
import { Tooltip, TooltipTrigger, TooltipContent } from '@spatialhub/ui';
import { cn } from '@/lib/utils';
import { useWeatherLocationStore } from '@/features/weather/store/weather-location';
import { useDataDisplayStore } from '@/features/settings/store/data-display';
import { useNavigate } from 'react-router-dom';
import { geocodingService, GeocodingResult } from '@/features/interactive-map/services/geocoding';
import { useTranslation } from '@spatialhub/i18n';

const REFRESH_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes

// UV Index helper - returns key for translation
const getUvLevelKey = (uv: number): { key: string; color: string; bgColor: string } => {
  if (uv <= 2) return { key: 'low', color: 'text-green-600', bgColor: 'bg-green-100' };
  if (uv <= 5) return { key: 'moderate', color: 'text-yellow-600', bgColor: 'bg-yellow-100' };
  if (uv <= 7) return { key: 'high', color: 'text-orange-600', bgColor: 'bg-orange-100' };
  if (uv <= 10) return { key: 'veryHigh', color: 'text-red-600', bgColor: 'bg-red-100' };
  return { key: 'extreme', color: 'text-purple-600', bgColor: 'bg-purple-100' };
};

interface WeatherDropdownProps {
  showSettingsIcon?: boolean;
}

const WeatherDropdown: React.FC<WeatherDropdownProps> = ({ showSettingsIcon = true }) => {
  const { t } = useTranslation();
  const { location, setLocation } = useWeatherLocationStore();
  const { temperatureUnit } = useDataDisplayStore();
  
  // UV level with translations
  const getUvLevel = (uv: number): { label: string; color: string; bgColor: string; description: string } => {
    const { key, color, bgColor } = getUvLevelKey(uv);
    return {
      label: t(`weather.uvLevels.${key}`),
      color,
      bgColor,
      description: t(`weather.uvDescriptions.${key}`)
    };
  };
  const [currentWeather, setCurrentWeather] = useState<CurrentWeatherData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<GeocodingResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const navigate = useNavigate();

  const fetchCurrentWeather = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await weatherService.getCurrentWeather(location.latitude, location.longitude);
      setCurrentWeather(data.current);
    } catch (err: unknown) {
      let message = 'Failed to fetch weather data';
      if (typeof err === 'object' && err !== null && 'error' in (err as Record<string, unknown>)) {
        const maybe = err as { error?: unknown };
        message = typeof maybe.error === 'string' ? maybe.error : message;
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [location.latitude, location.longitude]);

  useEffect(() => {
    fetchCurrentWeather();
    const interval = setInterval(fetchCurrentWeather, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchCurrentWeather]);

  // Search for locations with debounce
  useEffect(() => {
    if (searchTimeoutRef.current) {
      clearTimeout(searchTimeoutRef.current);
    }

    if (searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    searchTimeoutRef.current = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await geocodingService.search(searchQuery);
        setSearchResults(results.slice(0, 5));
      } catch {
        setSearchResults([]);
      } finally {
        setIsSearching(false);
      }
    }, 300);

    return () => {
      if (searchTimeoutRef.current) {
        clearTimeout(searchTimeoutRef.current);
      }
    };
  }, [searchQuery]);

  // Handle location selection
  const handleLocationSelect = (result: GeocodingResult) => {
    setLocation({
      id: `geocoded-${result.latitude.toFixed(4)},${result.longitude.toFixed(4)}`,
      name: result.name,
      latitude: result.latitude,
      longitude: result.longitude,
      source: 'geocoded',
    });
    setSearchQuery('');
    setSearchResults([]);
    setIsDropdownOpen(false);
  };

  // Close dropdown when mouse leaves
  const handleMouseEnter = () => setIsDropdownOpen(true);
  const handleMouseLeave = () => {
    if (document.activeElement !== searchInputRef.current) {
      setIsDropdownOpen(false);
      setSearchQuery('');
      setSearchResults([]);
    }
  };
  
  // Handle click to refresh
  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    fetchCurrentWeather();
  };

  const getWeatherIcon = (code: number, size: string = 'w-5 h-5') => {
    const iconClass = cn(size, 'transition-transform duration-200');
    const MUTED_COLOR = 'text-gray-500 dark:text-gray-300';
    if (code === 0 || code === 1) return <Sun className={cn(iconClass, 'text-yellow-500')} />;
    if (code === 2 || code === 3) return <Cloud className={cn(iconClass, MUTED_COLOR)} />;
    if (code >= 51 && code <= 67) return <CloudRain className={cn(iconClass, 'text-blue-500')} />;
    if (code >= 71 && code <= 86) return <CloudSnow className={cn(iconClass, 'text-blue-300')} />;
    if (code >= 95 && code <= 99) return <Zap className={cn(iconClass, 'text-purple-500')} />;
    if (code === 45 || code === 48) return <Eye className={cn(iconClass, MUTED_COLOR)} />;
    return <Cloud className={cn(iconClass, MUTED_COLOR)} />;
  };

  const formatTemperature = (celsius: number) => {
    if (temperatureUnit === 'fahrenheit') {
      return `${Math.round((celsius * 9/5) + 32)}°`;
    }
    return `${Math.round(celsius)}°`;
  };

  const getTemperatureBoth = (celsius: number) => {
    const c = Math.round(celsius);
    const f = Math.round((celsius * 9/5) + 32);
    return { celsius: c, fahrenheit: f };
  };

  const handleSettingsClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate('/app/settings/weather');
  };

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-card border border-border shadow-sm">
        <div className="w-4 h-4 rounded-full border-2 border-muted-foreground border-t-foreground animate-spin" />
        <span className="text-xs text-muted-foreground">Loading...</span>
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={fetchCurrentWeather}
            className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-card border border-destructive/30 shadow-sm hover:border-destructive/50 transition-all duration-200 cursor-pointer"
          >
            <AlertTriangle className="w-4 h-4 text-destructive" />
            <span className="text-xs text-destructive">{t('weather.retry')}</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="bottom">
          {error}. {t('weather.clickToRetry')}
        </TooltipContent>
      </Tooltip>
    );
  }

  // Weather display
  if (currentWeather) {
    const temps = getTemperatureBoth(currentWeather.temperature);
    
    return (
      <section 
        className="relative" 
        ref={dropdownRef} 
        onMouseEnter={handleMouseEnter} 
        onMouseLeave={handleMouseLeave}
        aria-label="Weather information"
      >
        {/* Main weather display */}
        <div className="flex items-center gap-1">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={handleClick}
                aria-label="Weather information - click to refresh"
                className={cn(
                  'relative flex items-center gap-2.5 px-3 py-1.5 rounded-md',
                  'bg-card',
                  'border border-border shadow-sm',
                  'hover:bg-muted hover:shadow-md',
                  'transition-all duration-300 ease-out cursor-pointer',
                  'overflow-hidden'
                )}
              >
                {/* Weather icon */}
                <div className="relative z-10">
                  {getWeatherIcon(currentWeather.weather_code, 'w-5 h-5')}
                </div>
                
                {/* Temperature */}
                <span className="relative z-10 text-base font-semibold text-foreground tracking-tight">
                  {formatTemperature(currentWeather.temperature)}
                </span>
                
                {/* Divider */}
                <div className="hidden sm:block w-px h-4 bg-border" />
                
                {/* Location */}
                <div className="hidden sm:flex items-center gap-1 relative z-10">
                  <MapPin className="w-3 h-3 text-muted-foreground" />
                  <span className="text-xs text-muted-foreground max-w-[80px] truncate">
                    {location.name}
                  </span>
                </div>
              </button>
            </TooltipTrigger>
            <TooltipContent>{t('weather.clickToRefresh')}</TooltipContent>
          </Tooltip>
          
          {/* Settings button - separate from main button */}
          {showSettingsIcon && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={handleSettingsClick}
                  className={cn(
                    'p-1.5 rounded-md',
                    'bg-card border border-border',
                    'text-muted-foreground hover:text-foreground',
                    'hover:bg-muted',
                    'transition-all duration-200',
                    'cursor-pointer'
                  )}
                  aria-label="Weather settings"
                >
                  <Settings2 className="w-3.5 h-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent>Weather settings</TooltipContent>
            </Tooltip>
          )}
        </div>

        {/* Dropdown panel - rectangular design */}
        {isDropdownOpen && (
          <div className="absolute top-full right-0 mt-2 bg-card border border-border rounded-md shadow-xl p-4 min-w-[220px] z-50">
            {/* Header */}
            <div className="flex items-center gap-2 pb-3 border-b border-border">
              {getWeatherIcon(currentWeather.weather_code, 'w-7 h-7')}
              <div>
                <p className="text-sm font-medium text-foreground">{currentWeather.description}</p>
                <p className="text-xs text-muted-foreground">{location.name}</p>
              </div>
            </div>
            
            {/* Details with both units displayed */}
            <div className="grid grid-cols-1 gap-2 mt-3">
              {/* Temperature - shows both C and F */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center justify-between p-2 rounded-md hover:bg-muted cursor-pointer transition-colors">
                    <div className="flex items-center gap-2">
                      <Thermometer className="w-4 h-4 text-orange-500" />
                      <span className="text-sm text-muted-foreground">{t('weather.temperature')}</span>
                    </div>
                    <span className="text-sm font-medium text-foreground">
                      {temps.celsius}°C / {temps.fahrenheit}°F
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="left" className="bg-gray-900 text-white border-gray-700 shadow-lg">
                  <p className="text-xs">{t('weather.temperatureTooltip')}</p>
                </TooltipContent>
              </Tooltip>

              {/* Wind speed - shows both km/h and mph */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center justify-between p-2 rounded-md hover:bg-muted cursor-pointer transition-colors">
                    <div className="flex items-center gap-2">
                      <Wind className="w-4 h-4 text-cyan-500" />
                      <span className="text-sm text-muted-foreground">{t('weather.windSpeed')}</span>
                    </div>
                    <span className="text-sm font-medium text-foreground">
                      {currentWeather.wind_speed ?? '--'} km/h
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="left" className="bg-gray-900 text-white border-gray-700 shadow-lg">
                  <p className="text-xs">{currentWeather.wind_speed ?? '--'} km/h ({Math.round((currentWeather.wind_speed ?? 0) * 0.621)} mph)</p>
                </TooltipContent>
              </Tooltip>

              {/* Humidity */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center justify-between p-2 rounded-md hover:bg-muted cursor-pointer transition-colors">
                    <div className="flex items-center gap-2">
                      <Droplets className="w-4 h-4 text-sky-500" />
                      <span className="text-sm text-muted-foreground">{t('weather.humidity')}</span>
                    </div>
                    <span className="text-sm font-medium text-foreground">
                      {currentWeather.humidity ?? '--'}%
                    </span>
                  </div>
                </TooltipTrigger>
                <TooltipContent side="left" className="bg-gray-900 text-white border-gray-700 shadow-lg">
                  <p className="text-xs">{t('weather.humidityTooltip')}</p>
                </TooltipContent>
              </Tooltip>

              {/* UV Index */}
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="flex items-center justify-between p-2 rounded-md hover:bg-muted cursor-pointer transition-colors">
                    <div className="flex items-center gap-2">
                      <SunDim className={cn("w-4 h-4", currentWeather.uv_index == null ? "text-gray-400 dark:text-gray-300" : getUvLevel(currentWeather.uv_index).color)} />
                      <span className="text-sm text-muted-foreground">{t('weather.uvIndex')}</span>
                    </div>
                    {currentWeather.uv_index == null ? (
                      <span className="text-sm text-muted-foreground">--</span>
                    ) : (
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "text-xs font-medium px-2 py-0.5 rounded-full",
                          getUvLevel(currentWeather.uv_index).bgColor,
                          getUvLevel(currentWeather.uv_index).color
                        )}>
                          {getUvLevel(currentWeather.uv_index).label}
                        </span>
                        <span className="text-sm font-medium text-foreground">
                          {Math.round(currentWeather.uv_index)}
                        </span>
                      </div>
                    )}
                  </div>
                </TooltipTrigger>
                <TooltipContent side="left" className="bg-gray-900 text-white border-gray-700 shadow-lg">
                  <p className="text-xs">
                    {currentWeather.uv_index == null 
                      ? "UV data not available (nighttime)"
                      : getUvLevel(currentWeather.uv_index).description}
                  </p>
                </TooltipContent>
              </Tooltip>
            </div>
            
            {/* Search box for location */}
            <div className="mt-3 pt-3 border-t border-border">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onFocus={() => setIsDropdownOpen(true)}
                  placeholder={t('weather.searchLocation')}
                  className="w-full pl-8 pr-3 py-1.5 text-xs border border-border rounded-md bg-card text-foreground placeholder-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring focus:border-ring"
                />
                {isSearching && (
                  <Loader2 className="absolute right-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground animate-spin" />
                )}
              </div>
              
              {/* Search results */}
              {searchResults.length > 0 && (
                <div className="mt-2 max-h-[150px] overflow-y-auto">
                  {searchResults.map((result, index) => (
                    <button
                      key={`${result.id}-${index}`}
                      onClick={() => handleLocationSelect(result)}
                      className="w-full flex items-center gap-2 px-2 py-1.5 text-left hover:bg-muted rounded-md transition-colors"
                    >
                      <MapPin className="w-3 h-3 text-muted-foreground flex-shrink-0" />
                      <p className="flex-1 text-xs font-medium text-foreground truncate">{result.name}</p>
                    </button>
                  ))}
                </div>
              )}
            </div>
            
            <div className="w-full mt-3 pt-3 border-t border-border text-xs text-muted-foreground text-center space-y-1">
              <p>{t('weather.clickToRefresh')}</p>
              <p>
                {t('weather.dataBy')}{' '}
                <a 
                  href="https://open-meteo.com/" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="underline hover:text-foreground transition-colors"
                >
                  Open-Meteo.com
                </a>
              </p>
            </div>
          </div>
        )}
      </section>
    );
  }

  // Default state - no weather data yet
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          onClick={fetchCurrentWeather}
          className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-card border border-border shadow-sm hover:bg-muted transition-all duration-200 cursor-pointer"
        >
          <Cloud className="w-4 h-4 text-muted-foreground" />
          <span className="text-xs text-muted-foreground">{t('weather.loadWeather')}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom">
        {t('weather.clickToLoad', { location: location.name })}
      </TooltipContent>
    </Tooltip>
  );
};

export default WeatherDropdown;
