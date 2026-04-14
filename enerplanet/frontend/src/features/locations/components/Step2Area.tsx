import type { FC } from 'react';
import { MapPin, CheckCircle, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Step2AreaProps {
  polygonCoordinates: [number, number][];
  area: number;
  onClear: () => void;
}

const formatArea = (areaValue: number): string => {
  if (areaValue > 10000) return `${(areaValue / 1_000_000).toFixed(2)} km²`;
  return `${areaValue.toFixed(0)} m²`;
};

const Step2Area: FC<Step2AreaProps> = ({ polygonCoordinates, area, onClear }) => {
  const hasPolygon = polygonCoordinates.length >= 3;

  return (
    <div className="space-y-4">
      <div className="bg-muted/50 rounded-lg p-3 border border-border">
        <div className="flex items-center gap-2 mb-2">
          <MapPin className="w-4 h-4 text-primary" />
          <span className="text-sm font-medium text-foreground">Draw Area on Map</span>
        </div>
        <p className="text-xs text-muted-foreground">
          Click on the map to draw a polygon defining the location boundary. Use the region selector above the map to quickly navigate to a region.
        </p>
      </div>

      {/* Area Status */}
      <div className={cn(
        'rounded-lg p-3 border transition-colors',
        hasPolygon ? 'border-green-500/50 bg-green-50/50 dark:bg-green-900/10' : 'border-border bg-background',
      )}>
        <div className="flex items-center justify-between">
          <span className="text-sm text-foreground">Area Status</span>
          {hasPolygon ? (
            <span className="flex items-center gap-1 text-xs font-medium text-green-600 dark:text-green-400">
              <CheckCircle className="w-3.5 h-3.5" />
              Defined
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Not drawn</span>
          )}
        </div>
        {hasPolygon && (
          <>
            <div className="flex justify-between mt-2 text-xs text-muted-foreground">
              <span>Calculated Area</span>
              <span className="font-medium text-foreground">{formatArea(area)}</span>
            </div>
            <div className="flex justify-between mt-1 text-xs text-muted-foreground">
              <span>Vertices</span>
              <span className="font-medium text-foreground">{polygonCoordinates.length}</span>
            </div>
            <button
              type="button"
              onClick={onClear}
              className="w-full mt-3 flex items-center justify-center gap-1.5 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-destructive border border-border rounded-lg hover:bg-muted transition-colors"
            >
              <Trash2 className="w-3 h-3" />
              Clear Area
            </button>
          </>
        )}
      </div>
    </div>
  );
};

export default Step2Area;
