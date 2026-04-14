import { useState, type FC, type ChangeEvent } from 'react';
import { Loader2, Zap, CheckCircle, RefreshCw } from 'lucide-react';
import energyService from '@/features/configurator/services/energyService';
import { getEnergyLabelColorClasses } from '@/features/configurator/utils/energyLabelUtils';
import type { BuildingProperties } from './Step3BuildingProperties';
import { cn } from '@/lib/utils';

interface Step4DemandSaveProps {
  demandEnergy: number;
  setDemandEnergy: (v: number) => void;
  peakLoad: number;
  setPeakLoad: (v: number) => void;
  title: string;
  area: number;
  isPublic: boolean;
  tags: string[];
  properties: BuildingProperties;
  polygonCoordinates: [number, number][];
  isLoading: boolean;
  onSave: () => void;
  editMode: boolean;
}

const formatArea = (areaValue: number): string => {
  if (areaValue > 10000) return `${(areaValue / 1_000_000).toFixed(2)} km²`;
  return `${areaValue.toFixed(0)} m²`;
};

const Step4DemandSave: FC<Step4DemandSaveProps> = ({
  demandEnergy, setDemandEnergy, peakLoad, setPeakLoad,
  title, area, isPublic, tags, properties, polygonCoordinates,
  isLoading, onSave, editMode,
}) => {
  const [estimating, setEstimating] = useState(false);
  const [estimated, setEstimated] = useState(false);

  const handleEstimate = async () => {
    setEstimating(true);
    try {
      const modifiedArea = area * (1 + properties.areaModifier / 100);
      const result = await energyService.estimateBuildingEnergyDemand(
        properties.fClass,
        modifiedArea,
        undefined,
        properties.constructionYear || undefined,
        properties.floors || undefined,
        properties.energyLabel || undefined,
        properties.hotWaterElectric ?? undefined,
      );
      setDemandEnergy(Math.round(result.yearlyConsumptionKwh));
      setPeakLoad(Math.round(result.peakLoadKw * 100) / 100);
      setEstimated(true);
    } catch {
      // keep current values on error
    } finally {
      setEstimating(false);
    }
  };

  const canSave = title.trim() && polygonCoordinates.length >= 3 && properties.fClass;

  return (
    <div className="space-y-4">
      {/* Estimate Button */}
      <button
        type="button"
        onClick={handleEstimate}
        disabled={estimating}
        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-lg border border-primary/50 bg-primary/5 hover:bg-primary/10 text-primary text-sm font-medium transition-colors disabled:opacity-50"
      >
        {estimating ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <RefreshCw className="w-4 h-4" />
        )}
        {estimating ? 'Estimating...' : 'Estimate from Pylovo'}
      </button>
      {estimated && (
        <p className="text-[10px] text-green-600 dark:text-green-400 flex items-center gap-1 -mt-2">
          <CheckCircle className="w-3 h-3" /> Values estimated from building properties
        </p>
      )}

      {/* Energy Demand */}
      <div>
        <label htmlFor="demand-input" className="block text-xs font-medium text-foreground mb-1">
          Energy Demand (kWh/year) *
        </label>
        <div className="relative">
          <Zap className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <input
            id="demand-input"
            type="number"
            min={0}
            step={100}
            value={demandEnergy}
            onChange={(e: ChangeEvent<HTMLInputElement>) => setDemandEnergy(Number(e.target.value || 0))}
            className="w-full pl-9 pr-3 py-2 border border-border rounded-lg bg-background dark:bg-gray-700 text-foreground text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Peak Load */}
      <div>
        <label htmlFor="peak-load" className="block text-xs font-medium text-foreground mb-1">
          Peak Load (kW)
        </label>
        <input
          id="peak-load"
          type="number"
          min={0}
          step={0.1}
          value={peakLoad}
          onChange={(e: ChangeEvent<HTMLInputElement>) => setPeakLoad(Number(e.target.value || 0))}
          className="w-full px-3 py-2 border border-border rounded-lg bg-background dark:bg-gray-700 text-foreground text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
        />
      </div>

      {/* Summary Card */}
      <div className="bg-muted/50 border border-border rounded-lg p-3">
        <h4 className="text-xs font-semibold text-foreground mb-2">Summary</h4>
        <div className="space-y-1 text-[11px] text-muted-foreground">
          <Row label="Name" value={title || '—'} />
          <Row label="Type" value={properties.fClass} capitalize />
          <Row label="Area" value={formatArea(area)} />
          {properties.areaModifier !== 0 && (
            <Row label="Area Modifier" value={`${properties.areaModifier > 0 ? '+' : ''}${properties.areaModifier}%`} />
          )}
          {properties.energyLabel && (
            <div className="flex justify-between">
              <span>Energy Label</span>
              <span className={cn('px-1.5 py-0.5 rounded text-[10px] font-bold', getEnergyLabelColorClasses(properties.energyLabel))}>
                {properties.energyLabel}
              </span>
            </div>
          )}
          {properties.height && <Row label="Height" value={`${properties.height} m`} />}
          {properties.floors && <Row label="Floors" value={String(properties.floors)} />}
          {properties.constructionYear && <Row label="Built" value={String(properties.constructionYear)} />}
          {properties.heatingType && <Row label="Heating" value={properties.heatingType.replace('_', ' ')} capitalize />}
          <Row label="Hot Water" value={properties.hotWaterElectric === true ? 'Electric' : properties.hotWaterElectric === false ? 'Non-electric' : 'Not specified'} />
          <Row label="Visibility" value={isPublic ? 'Public' : 'Private'} />
          {tags.length > 0 && <Row label="Tags" value={tags.join(', ')} />}
          <div className="border-t border-border/50 pt-1 mt-1">
            <Row label="Demand" value={`${demandEnergy.toLocaleString()} kWh/yr`} bold />
            {peakLoad > 0 && <Row label="Peak Load" value={`${peakLoad} kW`} bold />}
          </div>
        </div>
      </div>

      {/* Save Button */}
      <button
        type="button"
        onClick={onSave}
        disabled={isLoading || !canSave}
        className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {isLoading && <Loader2 className="w-4 h-4 animate-spin" />}
        {editMode ? 'Update Location' : 'Save Location'}
      </button>
    </div>
  );
};

const Row: FC<{ label: string; value: string; bold?: boolean; capitalize?: boolean }> = ({ label, value, bold, capitalize }) => (
  <div className="flex justify-between">
    <span>{label}</span>
    <span className={cn('font-medium text-foreground', capitalize && 'capitalize', bold && 'font-semibold')}>{value}</span>
  </div>
);

export default Step4DemandSave;
