import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface ChartView<T extends string> {
  id: T;
  icon: ReactNode;
  name: string;
  /** The kind of chart under the tab, such as "Bar chart, one bar per day". */
  kind: string;
}

/** One tab per chart, so a panel renders only the chosen chart and every chart is visible as a tab. */
export function ViewTabs<T extends string>({ views, value, onChange }: { views: ChartView<T>[]; value: T; onChange: (id: T) => void }) {
  return (
    <div role="tablist" className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(10rem,1fr))] gap-2">
      {views.map((v) => (
        <button
          key={v.id}
          type="button"
          role="tab"
          aria-selected={v.id === value}
          onClick={() => onChange(v.id)}
          className={cn(
            'flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 text-left transition-colors',
            v.id === value ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50',
          )}
        >
          <span className="mt-0.5 shrink-0">{v.icon}</span>
          <span className="min-w-0">
            <span className="block text-sm font-semibold text-foreground">{v.name}</span>
            <span className="block text-xs text-muted-foreground">{v.kind}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
