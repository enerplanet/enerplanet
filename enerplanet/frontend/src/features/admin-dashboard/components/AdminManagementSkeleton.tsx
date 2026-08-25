interface AdminManagementSkeletonProps {
  label: string;
  summaryCards?: number;
  rows?: number;
}

export function AdminManagementSkeleton({
  label,
  summaryCards = 0,
  rows = 5,
}: AdminManagementSkeletonProps) {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">{label}</span>
      {summaryCards > 0 && (
        <div
          className={`grid grid-cols-2 gap-3 ${summaryCards === 5 ? "md:grid-cols-5" : "md:grid-cols-4"}`}
        >
          {Array.from({ length: summaryCards }, (_, index) => (
            <div key={index} className="rounded-xl border border-border bg-card p-3 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="md-skeleton h-8 w-8 shrink-0 rounded-lg bg-muted" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div
                    className="md-skeleton h-2.5 w-20 rounded bg-muted"
                    style={{ animationDelay: `${index * 60}ms` }}
                  />
                  <div
                    className="md-skeleton h-4 w-10 rounded bg-muted"
                    style={{ animationDelay: `${index * 60 + 30}ms` }}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
        <div className="border-b border-border bg-muted/40 px-4 py-3">
          <div className="md-skeleton h-3 w-36 rounded-md bg-muted" />
        </div>
        <div className="divide-y divide-border">
          {Array.from({ length: rows }, (_, index) => (
            <div key={index} className="flex items-center gap-4 px-4 py-3.5">
              <div className="md-skeleton h-8 w-8 shrink-0 rounded-lg bg-muted" />
              <div
                className="md-skeleton h-3.5 w-full max-w-[220px] rounded-md bg-muted"
                style={{ animationDelay: `${index * 90}ms` }}
              />
              <div className="md-skeleton hidden h-5 w-20 shrink-0 rounded-full bg-muted sm:block" />
              <div className="md-skeleton hidden h-3.5 w-24 shrink-0 rounded-md bg-muted md:block" />
              <div className="md-skeleton ml-auto h-6 w-24 shrink-0 rounded-md bg-muted" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
