import { Flame, Zap } from 'lucide-react';
import { useTranslation } from '@spatialhub/i18n';
import { CARRIER_LABELS } from '../types';

interface CarrierToggleProps {
  /** Carriers present in the results (raw labels from backend). */
  carriers: string[];
  /** Active carrier; '' means default (backend "power"). */
  activeCarrier: string;
  onSelect: (carrier: string) => void;
}

/**
 * Segmented control to switch between energy carriers (electricity / heat).
 * Hidden entirely when only one carrier is available. Carriers are treated
 * as bucket labels — the only special-casing is the display icon; anything
 * that is not heat/thermal gets the electricity icon.
 */
export const CarrierToggle = ({ carriers, activeCarrier, onSelect }: CarrierToggleProps) => {
  const { t } = useTranslation();

  if (carriers.length <= 1) return null;

  // Normalize '' (default) to the first available carrier for display.
  const active = activeCarrier === '' ? carriers[0] : activeCarrier;

  const labelFor = (carrier: string): string => {
    const key = CARRIER_LABELS[carrier.toLowerCase()];
    return key ? t(key) : carrier;
  };

  const isHeat = (carrier: string): boolean => {
    const c = carrier.toLowerCase();
    return c === 'heat' || c === 'thermal';
  };

  return (
    <div
      className="flex items-center gap-0.5 rounded-lg border border-border bg-muted/30 p-0.5"
      role="tablist"
      aria-label={t('results.carrier.toggleLabel')}
    >
      {carriers.map((carrier) => {
        const selected = carrier === active;
        const Icon = isHeat(carrier) ? Flame : Zap;
        return (
          <button
            key={carrier}
            role="tab"
            aria-selected={selected}
            onClick={() => onSelect(carrier)}
            className={`flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-all duration-150 ${
              selected
                ? 'bg-card text-foreground shadow-sm border border-border'
                : 'text-muted-foreground hover:text-foreground border border-transparent'
            }`}
          >
            <Icon className={`h-3.5 w-3.5 ${isHeat(carrier) ? 'text-orange-500' : 'text-primary'}`} />
            {labelFor(carrier)}
          </button>
        );
      })}
    </div>
  );
};

export default CarrierToggle;