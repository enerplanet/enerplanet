import type { LucideIcon } from 'lucide-react';
import { Loader2 } from 'lucide-react';
import { PanelSkeleton } from '@/components/ui/Skeletons';

// Shared surface for every chart/table card inside a results tab.
export const CHART_CARD_CLASS =
  'rounded-xl border border-border bg-card p-4 shadow-sm transition-shadow duration-200 hover:shadow-md';

interface PanelEmptyStateProps {
  icon: LucideIcon;
  title: string;
  description?: string;
}

// Empty state for a results tab, matching the dashboard's dashed-panel treatment.
export const PanelEmptyState = ({ icon: Icon, title, description }: PanelEmptyStateProps) => (
  <div className="p-4">
    <div className="md-fade-in flex flex-col items-center rounded-xl border border-dashed border-border bg-muted/30 px-6 py-14 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
        <Icon className="h-7 w-7 text-muted-foreground" />
      </div>
      <h3 className="text-base font-semibold tracking-tight text-foreground">{title}</h3>
      {description && <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">{description}</p>}
    </div>
  </div>
);

// Loading state for a results tab: chart-shaped placeholders instead of a spinner.
export const PanelLoadingState = ({ label }: { label: string }) => (
  <div className="space-y-4 p-4">
    <div className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" />
      <span>{label}</span>
    </div>
    <PanelSkeleton height="h-56" />
    <PanelSkeleton height="h-40" />
  </div>
);
