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
    className={`flex items-center justify-center rounded-lg border border-dashed border-amber-500/50 bg-amber-500/10 text-center text-xs font-medium text-amber-700 dark:text-amber-400 ${className}`}
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
 *
 * The local placeholder is deliberately AMBER (header + note + card ring) so it
 * never reads as a neutral part of the result: it marks a section that exists
 * only while SHOW_RESULT_GAPS is on and will drop out of a production build.
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
      <SectionHeader title={title} icon={Icon} warning />
      {note}
    </div>
  ) : (
    note
  );

  return (
    <div className={`${className ?? CHART_CARD_CLASS} ring-1 ring-amber-500/40`}>
      <SectionHeader title={title} icon={Icon} warning />
      {note}
    </div>
  );
};

const SectionHeader = ({
  title,
  icon: Icon,
  warning,
}: {
  title: string;
  icon?: LucideIcon;
  /** Tint the header as a local-only placeholder (see SHOW_RESULT_GAPS). */
  warning?: boolean;
}) => (
  <h4
    className={`mb-3 flex items-center gap-2 text-sm font-semibold ${
      warning ? 'text-amber-700 dark:text-amber-400' : 'text-foreground'
    }`}
  >
    {Icon && <Icon className={`w-4 h-4 ${warning ? 'text-amber-500' : 'text-primary'}`} />}
    {title}
  </h4>
);
