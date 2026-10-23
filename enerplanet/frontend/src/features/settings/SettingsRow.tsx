import type { ReactNode } from "react";

interface SettingsRowProps {
  title: string;
  description?: string;
  children: ReactNode;
}

/** One setting: its name and description on the left, its control on the right, stacked on narrow screens. */
export function SettingsRow({ title, description, children }: SettingsRowProps) {
  return (
    <div className="grid gap-2 border-b border-border px-4 py-4 last:border-b-0 md:grid-cols-[16rem_1fr] md:gap-6">
      <div>
        <h3 className="text-sm font-medium text-foreground">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="min-w-0 max-w-2xl">{children}</div>
    </div>
  );
}
