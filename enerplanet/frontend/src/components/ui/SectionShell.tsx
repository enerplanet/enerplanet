import { ReactNode } from "react";
import { LucideIcon } from "lucide-react";

export interface ShellTab {
  key: string;
  label: string;
  /** A LucideIcon component, or an already-instantiated icon node. */
  icon: LucideIcon | ReactNode;
}

interface SectionShellProps {
  title: string;
  subtitle?: string;
  tabs?: ShellTab[];
  activeTab?: string;
  onTabChange?: (key: string) => void;
  children: ReactNode;
}

/**
 * Two-pane page frame: a left `w-64` rail with the title and an icon+label tab
 * list, and the active section's content on the right. Mirrors the Legal pages
 * so every page reachable from the profile submenu shares the same layout.
 * With no `tabs` the rail shows just the header (a single-section page).
 */
export function SectionShell({
  title,
  subtitle,
  tabs = [],
  activeTab,
  onTabChange,
  children,
}: SectionShellProps) {
  return (
    <div className="flex h-full bg-background">
      {/* Left rail: header + tab navigation */}
      <div className="w-64 bg-card border-r border-border flex flex-col">
        <div className="p-6 border-b border-border">
          <h1 className="text-2xl font-bold text-foreground">{title}</h1>
          {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
        </div>
        {tabs.length > 0 && (
          <nav className="flex-1 p-4">
            <div className="space-y-2">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => onTabChange?.(tab.key)}
                    className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
                      activeTab === tab.key
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:bg-muted hover:text-foreground"
                    }`}
                  >
                    {typeof Icon === "function" ? <Icon className="w-5 h-5" /> : Icon}
                    <span className="text-sm font-medium">{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </nav>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto">
        <div className="p-6">{children}</div>
      </div>
    </div>
  );
}

export default SectionShell;