import React, { useState, useEffect, useRef } from "react";
import { geocodingService, GeocodingResult } from "@/features/interactive-map/services/geocoding";
import { Input, Tooltip, TooltipContent, TooltipTrigger } from "@spatialhub/ui";
import { useMapStore } from "@/features/interactive-map/store/map-store";
import { fromLonLat } from "ol/proj";
import { Search, X } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";
import { loadSearchBoundaryLayer, removeSearchBoundaryLayer, fitToFeatures } from "@/features/configurator/utils/gridLayerUtils";

const MapSearchBar: React.FC = () => {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const { map } = useMapStore();

  const selectResult = (r: GeocodingResult) => {
    if (!map) return;

    // If the result has a boundary polygon, show it and fit to it
    if (r.geojson && (r.geojson as any).type !== 'Point') {
      const layer = loadSearchBoundaryLayer(map, r.geojson, r.name);
      const features = layer.getSource()?.getFeatures();
      if (features && features.length > 0) {
        fitToFeatures(map, features, { padding: 60, duration: 500, maxZoom: 14 });
      }
    } else {
      // No boundary — just pan to coordinates
      removeSearchBoundaryLayer(map);
      const position = fromLonLat([r.longitude, r.latitude]);
      map.getView().animate({
        center: position,
        zoom: 12,
        duration: 500,
      });
    }

    // Clear search UI and collapse
    setSearch("");
    setResults([]);
    setIsExpanded(false);
    if (inputRef.current) inputRef.current.blur();
  };

  // Handle click outside to close search bar
  useEffect(() => {
    if (!isExpanded) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        handleCollapse();
      }
    };

    // Add small delay to prevent immediate closure when opening
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 100);

    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isExpanded]);

  // Debounced search for geocode
  useEffect(() => {
    if (!search.trim()) {
      setResults([]);
      setSearchError(null);
      return;
    }
    setSearchLoading(true);
    setSearchError(null);
    const timer = setTimeout(async () => {
      try {
        const res = await geocodingService.search(search);
        setResults(res || []);
        if (res.length === 0) {
          setSearchError("No locations found");
        }
      } catch {
        setSearchError("Search failed");
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const handleExpand = () => {
    setIsExpanded(true);
    setTimeout(() => {
      inputRef.current?.focus();
    }, 100);
  };

  const handleCollapse = () => {
    setIsExpanded(false);
    setSearch("");
    setResults([]);
    setSearchError(null);
    if (map) {
      removeSearchBoundaryLayer(map);
    }
  };

  return (
    <div className="absolute top-4 left-4 z-10" ref={containerRef}>
      {isExpanded ? (
        // Expanded - Search Bar
        <div className="bg-popover text-popover-foreground rounded-lg shadow-lg p-2 w-80 max-w-[calc(100vw-2rem)] border border-border">
          <div className="flex items-center gap-2 mb-2">
            <Search className="w-4 h-4 text-muted-foreground flex-shrink-0" />
            <Input
              placeholder={t("common.tooltips.searchLocation")}
              value={search}
              ref={inputRef}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Escape") {
                  handleCollapse();
                }
                if (event.key === "Enter" && results.length > 0) {
                  event.preventDefault();
                  selectResult(results[0]);
                }
              }}
              className="border-0 focus-visible:ring-0 p-0 h-auto text-sm bg-transparent text-foreground"
            />
            <button
              onClick={handleCollapse}
              className="flex-shrink-0 hover:bg-muted rounded p-1"
              title={t("common.close")}
            >
              <X className="w-4 h-4 text-muted-foreground" />
            </button>
          </div>

          {searchLoading && <p className="text-xs text-muted-foreground px-2 py-1">Searching…</p>}

          {searchError && <p className="text-xs text-red-500 px-2 py-1">{searchError}</p>}

          {!searchLoading && results.length > 0 && (
            <div className="border border-border rounded-md max-h-60 overflow-auto divide-y divide-border bg-popover text-popover-foreground">
              {results.map((r) => (
                <button
                  type="button"
                  key={r.id}
                  className="w-full text-left px-3 py-2 hover:bg-muted text-sm transition-colors text-foreground"
                  onClick={() => selectResult(r)}
                >
                  {r.name}
                </button>
              ))}
            </div>
          )}
        </div>
      ) : (
        // Collapsed - Compact Search Icon Button
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              onClick={handleExpand}
              className="flex items-center justify-center size-8 rounded-full bg-popover text-popover-foreground shadow-lg hover:bg-muted transition-colors border border-border"
            >
              <Search className="w-4 h-4 text-popover-foreground" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="right">
            <p>{t("common.tooltips.searchLocation")}</p>
          </TooltipContent>
        </Tooltip>
      )}
    </div>
  );
};

export default MapSearchBar;
