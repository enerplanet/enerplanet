import { type FC, type ChangeEvent } from 'react';
import { getEnergyLabelColorClasses } from '@/features/configurator/utils/energyLabelUtils';
import { cn } from '@/lib/utils';

export interface BuildingProperties {
  fClass: string;
  energyLabel: string;
  height: number | '';
  floors: number | '';
  constructionYear: number | '';
  heatingType: string;
  hotWaterElectric: boolean | null;
  areaModifier: number;
}

interface Step3BuildingPropertiesProps {
  properties: BuildingProperties;
  onChange: (props: BuildingProperties) => void;
}

const F_CLASS_OPTIONS = [
  { value: 'house', label: 'House' },
  { value: 'apartments', label: 'Apartments' },
  { value: 'detached', label: 'Detached' },
  { value: 'semidetached_house', label: 'Semi-detached' },
  { value: 'terrace', label: 'Terrace' },
  { value: 'townhouse', label: 'Townhouse' },
  { value: 'bungalow', label: 'Bungalow' },
  { value: 'villa', label: 'Villa' },
  { value: 'commercial', label: 'Commercial' },
  { value: 'industrial', label: 'Industrial' },
  { value: 'retail', label: 'Retail' },
  { value: 'office', label: 'Office' },
  { value: 'school', label: 'School' },
  { value: 'kindergarten', label: 'Kindergarten' },
  { value: 'hospital', label: 'Hospital' },
  { value: 'church', label: 'Church' },
  { value: 'hotel', label: 'Hotel' },
  { value: 'restaurant', label: 'Restaurant' },
  { value: 'supermarket', label: 'Supermarket' },
  { value: 'warehouse', label: 'Warehouse' },
];

const ENERGY_LABELS = ['A', 'B', 'C', 'D', 'E', 'F', 'G'];

const HEATING_TYPES = [
  { value: '', label: 'Not specified' },
  { value: 'gas', label: 'Gas' },
  { value: 'electric', label: 'Electric' },
  { value: 'heat_pump', label: 'Heat Pump' },
  { value: 'district_heating', label: 'District Heating' },
  { value: 'oil', label: 'Oil' },
  { value: 'biomass', label: 'Biomass' },
];

const Step3BuildingProperties: FC<Step3BuildingPropertiesProps> = ({ properties, onChange }) => {
  const update = <K extends keyof BuildingProperties>(key: K, value: BuildingProperties[K]) => {
    onChange({ ...properties, [key]: value });
  };

  return (
    <div className="space-y-3">
      {/* f_class */}
      <div>
        <label htmlFor="fclass-select" className="block text-xs font-medium text-foreground mb-1">Building Type *</label>
        <select
          id="fclass-select"
          value={properties.fClass}
          onChange={(e) => update('fClass', e.target.value)}
          className="w-full px-3 py-2 border border-border rounded-lg bg-background dark:bg-gray-700 text-foreground text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
        >
          {F_CLASS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Area Modifier */}
      <div>
        <label htmlFor="area-mod" className="block text-xs font-medium text-foreground mb-1">
          Area Modifier: {properties.areaModifier > 0 ? '+' : ''}{properties.areaModifier}%
        </label>
        <input
          id="area-mod"
          type="range"
          min={-50}
          max={100}
          step={5}
          value={properties.areaModifier}
          onChange={(e) => update('areaModifier', Number(e.target.value))}
          className="w-full accent-primary"
        />
        <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5">
          <span>-50%</span><span>0%</span><span>+100%</span>
        </div>
      </div>

      {/* Energy Label */}
      <div>
        <label htmlFor="energy-label" className="block text-xs font-medium text-foreground mb-1">Energy Label</label>
        <div className="flex gap-1 flex-wrap">
          {ENERGY_LABELS.map((label) => (
            <button
              key={label}
              type="button"
              onClick={() => update('energyLabel', properties.energyLabel === label ? '' : label)}
              className={cn(
                'px-2 py-0.5 rounded text-[10px] font-bold border whitespace-nowrap transition-all',
                properties.energyLabel === label
                  ? `${getEnergyLabelColorClasses(label)} ring-2 ring-offset-1 ring-primary`
                  : 'border-border bg-muted/50 text-muted-foreground hover:bg-muted',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Height */}
        <div>
          <label htmlFor="height-input" className="block text-xs font-medium text-foreground mb-1">Height (m)</label>
          <input
            id="height-input"
            type="number"
            min={0}
            step={0.5}
            value={properties.height}
            onChange={(e: ChangeEvent<HTMLInputElement>) => update('height', e.target.value ? Number(e.target.value) : '')}
            placeholder="e.g. 8.5"
            className="w-full px-3 py-2 border border-border rounded-lg bg-background dark:bg-gray-700 text-foreground text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
        </div>

        {/* Floors */}
        <div>
          <label htmlFor="floors-input" className="block text-xs font-medium text-foreground mb-1">Floors</label>
          <input
            id="floors-input"
            type="number"
            min={1}
            max={100}
            step={1}
            value={properties.floors}
            onChange={(e: ChangeEvent<HTMLInputElement>) => update('floors', e.target.value ? Number(e.target.value) : '')}
            placeholder="e.g. 2"
            className="w-full px-3 py-2 border border-border rounded-lg bg-background dark:bg-gray-700 text-foreground text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
        </div>
      </div>

      {/* Construction Year */}
      <div>
        <label htmlFor="cyear-input" className="block text-xs font-medium text-foreground mb-1">Construction Year</label>
        <input
          id="cyear-input"
          type="number"
          min={1800}
          max={2030}
          step={1}
          value={properties.constructionYear}
          onChange={(e: ChangeEvent<HTMLInputElement>) => update('constructionYear', e.target.value ? Number(e.target.value) : '')}
          placeholder="e.g. 1990"
          className="w-full px-3 py-2 border border-border rounded-lg bg-background dark:bg-gray-700 text-foreground text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
        />
      </div>

      {/* Heating Type */}
      <div>
        <label htmlFor="heating-type" className="block text-xs font-medium text-foreground mb-1">Heating Type</label>
        <select
          id="heating-type"
          value={properties.heatingType}
          onChange={(e) => update('heatingType', e.target.value)}
          className="w-full px-3 py-2 border border-border rounded-lg bg-background dark:bg-gray-700 text-foreground text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
        >
          {HEATING_TYPES.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
      </div>

      {/* Hot Water Electric */}
      <div>
        <span className="block text-xs font-medium text-foreground mb-1">Electric Hot Water</span>
        <div className="flex gap-2">
          {(['Yes', 'No', 'Not specified'] as const).map((opt) => {
            const val = opt === 'Yes' ? true : opt === 'No' ? false : null;
            return (
              <button
                key={opt}
                type="button"
                onClick={() => update('hotWaterElectric', val)}
                className={cn(
                  'flex-1 px-2 py-1.5 rounded-lg border text-xs font-medium transition-colors',
                  properties.hotWaterElectric === val
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border hover:bg-muted text-muted-foreground',
                )}
              >
                {opt}
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Step3BuildingProperties;
