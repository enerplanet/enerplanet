/**
 * Placeholder for nodes whose UI lands in later phases (P4/P5).
 * Keeps the shell navigable without fake implementations.
 */
import type { NodeUiProps } from "../components/context-store";

export function PlaceholderNode({ goNext }: NodeUiProps) {
  return (
    <div className="mx-auto max-w-xl space-y-4 py-12 text-center">
      <p className="text-muted-foreground">
        This step's UI arrives in a later phase (see STATUS.md).
      </p>
      <button
        type="button"
        onClick={goNext}
        className="rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
      >
        Next
      </button>
    </div>
  );
}
