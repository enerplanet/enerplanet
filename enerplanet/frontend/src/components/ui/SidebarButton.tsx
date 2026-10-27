import React from "react";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { RAIL_ICON_SLOT, RAIL_LABEL } from "@/components/app-layout/rail";

interface SidebarButtonProps {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  isActive?: boolean;
  dataTour?: string;
  className?: string;
}

/** One page in the left rail: its icon, and its name while the rail is expanded. */
const SidebarButton: React.FC<SidebarButtonProps> = ({
  icon: Icon,
  label,
  onClick,
  isActive = false,
  dataTour,
  className = "",
}) => (
  <button
    type="button"
    onClick={onClick}
    data-tour={dataTour}
    data-rail-expand
    aria-current={isActive ? "page" : undefined}
    className={cn(
      "flex h-11 w-full cursor-pointer items-center rounded-lg transition-colors duration-normal",
      isActive ? "bg-muted text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground",
      className
    )}
  >
    <span className={RAIL_ICON_SLOT}>
      <Icon className="h-5 w-5" aria-hidden="true" />
    </span>
    <span className={RAIL_LABEL}>{label}</span>
  </button>
);

export default SidebarButton;
