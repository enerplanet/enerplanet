import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@spatialhub/ui";
import { Flame, Sparkles, Hand } from "lucide-react";
import { useRef, useState, type FC } from "react";

interface HeatBootstrapDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onAutoAssign: () => Promise<void>;
  onManual: () => void;
}

/**
 * One-time prompt shown after the grid (and its default heat demand) loads:
 * decide how to add heat technologies before hand-picking. Auto-assign sets the
 * mode to "expected" and runs the bulk resolve; Manual leaves techs empty for
 * the user to assign. Never reappears once a choice is made.
 */
export const HeatBootstrapDialog: FC<HeatBootstrapDialogProps> = ({
  open,
  onOpenChange,
  onAutoAssign,
  onManual,
}) => {
  const [running, setRunning] = useState(false);
  const autoAssignRef = useRef<HTMLButtonElement>(null);
  const manualRef = useRef<HTMLButtonElement>(null);

  const handleAutoAssign = async () => {
    if (running) return;
    setRunning(true);
    try {
      await onAutoAssign();
    } finally {
      setRunning(false);
    }
  };

  // Equal-weight options with keyboard nav: autofocus the first, ArrowUp/Down
  // (and ArrowLeft/Right) move focus between the two.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) return;
    e.preventDefault();
    const from = document.activeElement;
    const target =
      from === autoAssignRef.current ? manualRef.current : autoAssignRef.current;
    target?.focus();
  };

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="max-w-md !duration-300 !animate-in !fade-in-0 !zoom-in-100 !slide-in-from-top-0">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <Flame className="w-5 h-5 text-orange-500" />
            Heat technologies
          </AlertDialogTitle>
          <AlertDialogDescription className="sr-only">
            Choose how to add heat technologies to the buildings.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <p className="text-sm text-muted-foreground">
          Heat demand has been assigned to the buildings. How do you want to add
          heating technologies?
        </p>

        <div className="grid gap-2" onKeyDown={handleKeyDown}>
          <button
            ref={autoAssignRef}
            onClick={() => void handleAutoAssign()}
            disabled={running}
            autoFocus
            className="flex items-start gap-3 rounded-xl border border-primary/50 bg-background p-3 text-left transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            <Sparkles className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <span>
              <span className="block text-sm font-medium text-foreground">
                Auto-assign
              </span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                Give every building the expected-fit heating tech for its type
                (e.g. heat pump for houses, gas boiler for apartments, CHP for
                industrial). You can override any assignment afterwards.
              </span>
            </span>
          </button>

          <button
            ref={manualRef}
            onClick={onManual}
            disabled={running}
            className="flex items-start gap-3 rounded-xl border border-primary/50 bg-background p-3 text-left transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
          >
            <Hand className="h-5 w-5 text-primary mt-0.5 shrink-0" />
            <span>
              <span className="block text-sm font-medium text-foreground">
                Manual
              </span>
              <span className="block text-xs text-muted-foreground mt-0.5">
                Leave technologies empty — pick each building's heating tech by
                hand afterwards.
              </span>
            </span>
          </button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
};