import React from "react";
import { X } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";

interface SavedLocation {
  id: string;
  name: string;
}

interface SavedLocationsListProps {
  locations: SavedLocation[];
  currentLocationId?: string;
  onSelect: (location: SavedLocation) => void;
  onRemove: (id: string) => void;
  onClearAll: () => void;
  title?: string;
}

export const SavedLocationsList: React.FC<SavedLocationsListProps> = ({
  locations,
  currentLocationId,
  onSelect,
  onRemove,
  onClearAll,
  title,
}) => {
  const { t } = useTranslation();
  
  if (locations.length === 0) return null;

  return (
    <div className="flex-1 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-foreground">{title || t('settings.mapLocation.savedLocations')}</span>
        <button
          onClick={onClearAll}
          className="text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {t('settings.mapLocation.clearAll')}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {locations.map((loc) => (
          <div
            key={loc.id}
            className={`
              flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs transition-all cursor-pointer border
              ${
                currentLocationId === loc.id
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-muted text-muted-foreground hover:bg-accent border-border"
              }
            `}
          >
            <button
              type="button"
              onClick={() => onSelect(loc)}
              className="truncate max-w-[100px]"
            >
              {loc.name}
            </button>
            <button
              type="button"
              className={`hover:opacity-70 ${
                currentLocationId === loc.id ? "text-primary-foreground/70" : "text-muted-foreground"
              }`}
              onClick={(e) => {
                e.stopPropagation();
                onRemove(loc.id);
              }}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};
