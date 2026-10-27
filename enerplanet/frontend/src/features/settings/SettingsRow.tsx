import type { ReactNode } from "react";

interface SettingsRowProps {
  title: string;
  description?: string;
  children: ReactNode;
}

/**
 * One setting, styled like the Feedback form sections: the name and a muted
 * description on top, the control below on its own line, no card or borders.
 */
export function SettingsRow({ title, description, children }: SettingsRowProps) {
  return (
    <section className="space-y-2">
      <div>
        <h3 className="text-sm font-semibold text-foreground">{title}</h3>
        {description && <p className="mt-0.5 text-xs text-muted-foreground">{description}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </section>
  );
}
