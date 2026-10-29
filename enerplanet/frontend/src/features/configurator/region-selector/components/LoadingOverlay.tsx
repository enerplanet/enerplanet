import { Loader2 } from "lucide-react";

interface LoadingOverlayProps {
  isOpen: boolean;
  title?: string;
  description?: string;
}

export const LoadingOverlay = ({
  isOpen,
  title = "Loading Simulation Data",
  description = "Please wait while we load your energy simulation...",
}: LoadingOverlayProps) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-background/80 dark:bg-gray-900/80 backdrop-blur-sm z-50 flex items-center justify-center">
      <div className="bg-background dark:bg-gray-800 rounded-lg shadow-xl p-8 max-w-md mx-4 border border-border">
        <div className="flex flex-col items-center space-y-4">
          <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
          <div className="text-lg font-medium text-foreground">{title}</div>
          <div className="text-sm text-muted-foreground text-center">{description}</div>
        </div>
      </div>
    </div>
  );
};
