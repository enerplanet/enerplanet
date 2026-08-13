/**
 * React binding for the context core (Plan P3).
 * A thin useReducer wrapper — all logic stays in `context/reducer.ts`.
 */
import { useCallback, useMemo, useReducer } from "react";
import type { BackendAdapter } from "../adapter/types";
import { createEmptyContext } from "../context/defaults";
import { apply } from "../context/reducer";
import type { ContextAction, ModelContext } from "../context/types";

interface StoreState {
  ctx: ModelContext;
}

function reducer(state: StoreState, action: ContextAction): StoreState {
  return { ctx: apply(state.ctx, action).next };
}

export interface ContextStore {
  ctx: ModelContext;
  dispatch: (action: ContextAction) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  lastChange?: string;
}

export function useContextStore(initial?: ModelContext): ContextStore {
  const [state, dispatchRaw] = useReducer(reducer, { ctx: initial ?? createEmptyContext() });
  const dispatch = useCallback((action: ContextAction) => dispatchRaw(action), []);
  return useMemo(
    () => ({
      ctx: state.ctx,
      dispatch,
      undo: () => dispatchRaw({ type: "undo" }),
      redo: () => dispatchRaw({ type: "redo" }),
      canUndo: state.ctx.undoStack.length > 0,
      canRedo: state.ctx.redoStack.length > 0,
      lastChange: state.ctx.history[state.ctx.history.length - 1]?.actionType,
    }),
    [state, dispatch],
  );
}

/** Props every node UI receives from the shell. */
export interface NodeUiProps {
  store: ContextStore;
  api: BackendAdapter;
  /** Advance to the next workflow step. */
  goNext: () => void;
}
