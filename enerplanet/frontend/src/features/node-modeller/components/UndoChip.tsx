/**
 * Floating undo/redo chip (Plan P3, README_V2 §6.2).
 * Always visible — undo is free with diff-based history.
 */
import type { ContextStore } from "./context-store";

export function UndoChip({ store }: { store: ContextStore }) {
  if (!store.canUndo && !store.canRedo) return null;
  return (
    <div className="pointer-events-auto absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border bg-background/95 px-3 py-1.5 text-xs shadow-lg">
      <button
        type="button"
        onClick={store.undo}
        disabled={!store.canUndo}
        className="rounded px-2 py-0.5 hover:bg-muted disabled:opacity-40"
      >
        ⟲ Undo
      </button>
      <span className="text-muted-foreground">{store.lastChange ?? ""}</span>
      <button
        type="button"
        onClick={store.redo}
        disabled={!store.canRedo}
        className="rounded px-2 py-0.5 hover:bg-muted disabled:opacity-40"
      >
        ⟳ Redo
      </button>
    </div>
  );
}
