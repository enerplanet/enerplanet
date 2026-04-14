import React, { useState, useEffect, useRef } from "react";
import { Search, Loader2, Check } from "lucide-react";
import { geocodingService, GeocodingResult } from "@/features/interactive-map/services/geocoding";
import { useTranslation } from "@spatialhub/i18n";

interface LocationSearchProps {
  onSelect: (result: GeocodingResult) => void;
  isLocationAdded?: (result: GeocodingResult) => boolean;
  placeholder?: string;
  debounceMs?: number;
}

export const LocationSearch: React.FC<LocationSearchProps> = ({
  onSelect,
  isLocationAdded,
  placeholder,
  debounceMs = 400,
}) => {
  const { t } = useTranslation();
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<GeocodingResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!search.trim()) {
      setResults([]);
      setError(null);
      return;
    }

    const handle = setTimeout(async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await geocodingService.search(search.trim());
        setResults(res || []);
        if (res.length === 0) {
          setError(t('settings.locationSearch.noResults'));
        }
      } catch {
        setError(t('settings.locationSearch.searchFailed'));
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => clearTimeout(handle);
  }, [search, debounceMs]);

  const handleSelect = (r: GeocodingResult) => {
    onSelect(r);
    setSearch("");
    setResults([]);
    if (inputRef.current) inputRef.current.blur();
  };

  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
        <input
          ref={inputRef}
          type="text"
          placeholder={placeholder || t('settings.locationSearch.placeholder')}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-4 py-2.5 text-sm border-2 border-input rounded-lg bg-card text-foreground placeholder:text-muted-foreground focus:border-foreground focus:outline-none transition-colors"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setSearch("");
              setResults([]);
              setError(null);
              (e.target as HTMLInputElement).blur();
            }
            if (e.key === "Enter" && results.length > 0) {
              e.preventDefault();
              handleSelect(results[0]);
            }
          }}
        />
      </div>

      {loading && (
        <p className="text-xs text-muted-foreground flex items-center gap-1.5">
          <Loader2 className="w-3 h-3 animate-spin" />
          {t('settings.locationSearch.searching')}
        </p>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}

      {!loading && results.length > 0 && (
        <div className="border-2 border-input rounded-lg max-h-40 overflow-auto divide-y divide-border bg-card shadow-lg">
          {results.map((r) => {
            const added = isLocationAdded ? isLocationAdded(r) : false;
            return (
              <button
                type="button"
                key={r.id}
                className="w-full text-left px-3 py-2.5 hover:bg-muted text-sm text-foreground flex items-center justify-between transition-colors"
                onClick={() => handleSelect(r)}
              >
                <span className="truncate text-foreground">{r.name}</span>
                {added && <Check className="w-4 h-4 text-green-600 flex-shrink-0" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
};
