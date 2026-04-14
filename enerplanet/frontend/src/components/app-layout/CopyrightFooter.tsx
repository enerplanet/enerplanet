import React, { ComponentProps } from "react";
import { cn } from "@/lib/utils";

type Position =
  | "bottom-right"
  | "bottom-left"
  | "bottom-center"
  | "bottom-left-sidebar";

interface CopyrightFooterProps extends ComponentProps<"div"> {
  className?: string;
  position?: Position;
}

const POSITION_CLASSES: Record<Position, string> = {
  "bottom-right": "bottom-4 right-4",
  "bottom-left": "bottom-4 left-4",
  "bottom-center": "bottom-4 left-1/2 -translate-x-1/2",
  "bottom-left-sidebar": "bottom-4 left-[72px]",
};

export const CopyrightFooter: React.FC<CopyrightFooterProps> = ({
  className,
  position = "bottom-right",
  ...props
}) => {
  return (
    <div
      {...props}
      className={cn(
        "fixed z-40 animate-in slide-in-from-bottom-4 fade-in duration-700",
        POSITION_CLASSES[position],
        className
      )}
      aria-label="Copyright notice"
    >
      <p className="text-xs text-gray-500 px-2 py-1 rounded">
        © {new Date().getFullYear()}, Deggendorf Institute of Technology |{" "}
        <a
          href="https://www.openstreetmap.org/copyright"
          target="_blank"
          rel="noopener noreferrer"
          className="text-gray-500 hover:text-gray-700 underline"
        >
          OpenStreetMap contributors
        </a>
      </p>
    </div>
  );
};
