import { Flame, Fuel, Zap } from 'lucide-react';
import { useTranslation } from '@spatialhub/i18n';
import { carrierDisplay, normalizeCarrier } from '../carrierUnits';

interface CarrierToggleProps {
  /** Carriers present in the results (raw labels from backend). */
  carriers: string[];
  /** Active carrier; '' means default (backend "power"). */
  activeCarrier: string;
  onSelect: (carrier: string) => void;
}

/**
 * Segmented control to switch between energy carriers (electricity / heat /
 * gas). Hidden entirely when only one carrier is available. Carriers are
 * treated as bucket labels — the only special-casing is the display icon and
 * the unit shown in the button tooltip; anything not heat/volumetric gets the
 * electricity icon.
 */
export const CarrierToggle = ({ carriers, activeCarrier, onSelect }: CarrierToggleProps) => {
  const { t } = useTranslation();

  if (carriers.length <= 1) return null;

  // Normalize '' (default) to the first available carrier for display.
  const active = normalizeCarrier(activeCarrier);
  const activeIndex = carriers.findIndex((carrier) => normalizeCarrier(carrier) === active);
  const activeLabel = activeIndex >= 0 ? carriers[activeIndex] : carriers[0];

  const labelFor = (carrier: string): string => {
    const { labelKey } = carrierDisplay(carrier);
    return labelKey ? t(labelKey) : carrier;
  };

  const iconFor = (carrier: string) => {
    const display = carrierDisplay(carrier);
    if (display.generation) return { Icon: Zap, className: 'text-primary' };
    if (display.kind === 'volume') return { Icon: Fuel, className: 'text-amber-600 dark:text-amber-400' };
    return { Icon: Flame, className: 'text-orange-500' };
  };

  return (
    <div
      className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/30 p-0.5"
      role="tablist"
      aria-label={t('results.carrier.toggleLabel')}
    >
      {carriers.map((carrier) => {
        const selected = normalizeCarrier(carrier) === normalizeCarrier(activeLabel);
        const { Icon, className } = iconFor(carrier);
        const label = labelFor(carrier);
        const { energyUnit } = carrierDisplay(carrier);
        return (
          <button
            key={carrier}
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(carrier)}
            title={t('results.carrier.toggleItemHint', `${label} · ${energyUnit}`)}
            className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-all duration-150 ${
              selected
                ? 'bg-card text-foreground shadow-sm border border-border'
                : 'text-muted-foreground hover:text-foreground border border-transparent'
            }`}
          >
            <Icon className={`h-3.5 w-3.5 ${className}`} />
            {label}
          </button>
        );
      })}
    </div>
  );
};

export default CarrierToggle;
