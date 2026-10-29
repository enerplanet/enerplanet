interface ListSkeletonProps {
  rows?: number;
  /** Renders the muted header bar above the rows. */
  withHeader?: boolean;
  className?: string;
}

export function ListSkeleton({ rows = 6, withHeader = true, className = "" }: ListSkeletonProps) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-border ${className}`}
      aria-busy="true"
      aria-live="polite"
    >
      {withHeader && (
        <div className="border-b border-border bg-muted/40 px-4 py-3">
          <div className="md-skeleton h-3 w-36 rounded-md bg-muted" />
        </div>
      )}
      <div className="divide-y divide-border">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 px-4 py-3.5">
            <div className="md-skeleton h-4 w-4 shrink-0 rounded bg-muted" />
            <div
              className="md-skeleton h-3.5 w-full max-w-[220px] rounded-md bg-muted"
              style={{ animationDelay: `${i * 90}ms` }}
            />
            <div className="md-skeleton hidden h-5 w-20 shrink-0 rounded-full bg-muted sm:block" />
            <div className="md-skeleton hidden h-3.5 w-24 shrink-0 rounded-md bg-muted md:block" />
            <div className="md-skeleton ml-auto h-6 w-24 shrink-0 rounded-md bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

interface CardGridSkeletonProps {
  cards?: number;
  className?: string;
}

export function CardGridSkeleton({ cards = 8, className = "" }: CardGridSkeletonProps) {
  return (
    <div
      className={`grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 ${className}`}
      aria-busy="true"
      aria-live="polite"
    >
      {Array.from({ length: cards }, (_, i) => (
        <div key={i} className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-start gap-3">
            <div
              className="md-skeleton h-10 w-10 shrink-0 rounded-lg bg-muted"
              style={{ animationDelay: `${i * 60}ms` }}
            />
            <div className="min-w-0 flex-1 space-y-2">
              <div
                className="md-skeleton h-3.5 w-32 rounded-md bg-muted"
                style={{ animationDelay: `${i * 60 + 30}ms` }}
              />
              <div className="md-skeleton h-2.5 w-full rounded bg-muted" />
              <div className="md-skeleton h-2.5 w-2/3 rounded bg-muted" />
            </div>
          </div>
          <div className="mt-3 flex items-center justify-between">
            <div className="md-skeleton h-5 w-24 rounded-md bg-muted" />
            <div className="md-skeleton h-6 w-16 rounded-md bg-muted" />
          </div>
        </div>
      ))}
    </div>
  );
}

interface PanelSkeletonProps {
  /** Height of the placeholder body, e.g. "h-64". */
  height?: string;
  className?: string;
}

export function PanelSkeleton({ height = "h-64", className = "" }: PanelSkeletonProps) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-border bg-card shadow-sm ${className}`}
      aria-busy="true"
      aria-live="polite"
    >
      <div className="flex items-center justify-between border-b border-border bg-muted/40 px-4 py-3">
        <div className="md-skeleton h-3 w-40 rounded-md bg-muted" />
        <div className="md-skeleton h-3 w-16 rounded-md bg-muted" />
      </div>
      <div className="p-4">
        <div className={`md-skeleton w-full rounded-lg bg-muted ${height}`} />
      </div>
    </div>
  );
}
