import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from '@spatialhub/i18n';
import { CHART_CARD_CLASS } from './PanelStates';
import type { Capabilities } from '@/config/resultCapabilities';

// Local-only visibility: Vite statically substitutes DEV, so the placeholder is
// dead-code-eliminated from a production build. The env escape covers a *built*
// local bundle where DEV is false (a prod-like `npm run build` served locally).
export const SHOW_RESULT_GAPS =
  import.meta.env.DEV || import.meta.env.VITE_SHOW_RESULT_GAPS === 'true';

// Small in-place placeholder used when a capability is missing but we are local:
// keeps the slot, its name and the reason visible instead of silently dropping it.
export const GapNote = ({
  label,
  className = 'px-4 py-8',
}: {
  label: string;
  className?: string;
}) => (
  <div
    className={`flex items-center justify-center rounded-lg border border-dashed border-border bg-muted/30 text-center text-xs text-muted-foreground ${className}`}
  >
    {label}
  </div>
);

interface GatedSectionProps {
  requires: keyof Capabilities;
  capabilities: Capabilities;
  title: string;
  icon?: LucideIcon;
  /** Card class for the placeholder. Defaults to the shared results-chart card. */
  className?: string;
  /** Render as a bare block (no card wrapper) in the placeholder state. */
  bare?: boolean;
  children: ReactNode;
}

/**
 * Gate a result component on a declared capability.
 *
 * - capability met  -> children (the child owns its own card wrapper)
 * - not met + prod  -> null
 * - not met + local -> an in-place placeholder card naming the section
 */
export const GatedSection = ({
  requires,
  capabilities,
  title,
  icon: Icon,
  className,
  bare,
  children,
}: GatedSectionProps) => {
  // Hooks must run unconditionally, before any early return.
  const { t } = useTranslation();

  if (capabilities[requires]) return <>{children}</>;
  if (!SHOW_RESULT_GAPS) return null;

  const note = <GapNote label={t('results.grid.notInResult')} />;
  if (bare) return title || Icon ? (
    <div className="space-y-3">
      <SectionHeader title={title} icon={Icon} />
      {note}
    </div>
  ) : (
    note
  );

  return (
    <div className={className ?? CHART_CARD_CLASS}>
      <SectionHeader title={title} icon={Icon} />
      {note}
    </div>
  );
};

const SectionHeader = ({ title, icon: Icon }: { title: string; icon?: LucideIcon }) => (
  <h4 className="mb-3 flex items-center gap-2 text-sm font-semibold text-foreground">
    {Icon && <Icon className="w-4 h-4 text-primary" />}
    {title}
  </h4>
);
