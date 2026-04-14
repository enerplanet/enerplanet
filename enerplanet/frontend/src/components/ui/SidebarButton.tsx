import React from "react";
import { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Tooltip, TooltipTrigger, TooltipContent } from "@spatialhub/ui";

interface SidebarButtonProps {
  icon: LucideIcon;
  tooltip: string;
  onClick: () => void;
  isActive?: boolean;
  dataTour?: string;
  className?: string;
}

const SidebarButton: React.FC<SidebarButtonProps> = ({
  icon: Icon,
  tooltip,
  onClick,
  isActive = false,
  dataTour,
  className = "",
}) => {
  return (
    <div className="relative group">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={onClick}
            data-tour={dataTour}
            className={cn(
              "cursor-pointer w-11 h-11 rounded-button flex items-center justify-center transition-all duration-normal relative",
              "hover:bg-muted",
              className
            )}
          >
            <Icon
              className={cn(
                "cursor-pointer w-5 h-5",
                isActive ? "text-foreground" : "text-muted-foreground group-hover:text-foreground"
              )}
            />
            {isActive && (
              <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-3/5 h-0.5 rounded-full bg-foreground" />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">
          <p>{tooltip}</p>
        </TooltipContent>
      </Tooltip>
    </div>
  );
};

export default SidebarButton;
