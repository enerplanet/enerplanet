import {
  createContext,
  useCallback,
  useMemo,
  useReducer,
  type Dispatch,
  type ReactNode,
} from "react";
import type { ConfiguratorContext } from "../types/context";
import type { ModuleComplexity } from "../types/module";

/**
 * Reducer actions for the shared workflow context.
 *
 * The context is the single source of truth that flows between workflow
 * steps. Modules never mutate it directly — they call `onUpdate()` which
 * dispatches one of these actions.
 */
export type ModelBuilderAction =
  | { type: "UPDATE"; updates: Partial<ConfiguratorContext> }
  | { type: "SET_UI_MODE"; mode: ModuleComplexity }
  | { type: "SNAPSHOT" }
  | { type: "RESET"; initialState?: ConfiguratorContext };

/**
 * The value exposed by the context provider and consumed by modules via
 * `useModelBuilderContext()`.
 */
export interface ModelBuilderContextValue {
  /** The full shared workflow state. */
  context: ConfiguratorContext;
  /** Merge partial updates into the context (reducer action). */
  onUpdate: (updates: Partial<ConfiguratorContext>) => void;
  /** Toggle the global Basic/Expert UI mode. */
  setUiMode: (mode: ModuleComplexity) => void;
  /**
   * Snapshot the current context into `previousContext` for automatic
   * diffing (data handoff rule 4). Returns the snapshot that was stored.
   */
  snapshot: () => ConfiguratorContext;
  /** Reset the context to the initial state (optionally a new one). */
  reset: (initialState?: ConfiguratorContext) => void;
  /** Low-level dispatch, exposed for advanced/engine use. */
  dispatch: Dispatch<ModelBuilderAction>;
}

/**
 * Reducer that applies actions to the shared context immutably.
 */
function modelBuilderReducer(
  state: ConfiguratorContext,
  action: ModelBuilderAction
): ConfiguratorContext {
  switch (action.type) {
    case "UPDATE":
      return { ...state, ...action.updates };
    case "SET_UI_MODE":
      return { ...state, uiMode: action.mode };
    case "SNAPSHOT":
      // Preserve the current context for automatic diffing. We strip the
      // previous snapshot to avoid unbounded nesting.
      return { ...state, previousContext: { ...state, previousContext: undefined } };
    case "RESET":
      return action.initialState ?? {};
    default:
      return state;
  }
}

const ModelBuilderContext = createContext<ModelBuilderContextValue | undefined>(undefined);

export interface ModelBuilderContextProviderProps {
  /** Initial context state. Defaults to an empty object. */
  initialContext?: ConfiguratorContext;
  children: ReactNode;
}

/**
 * React context provider for the modular workflow shared state.
 *
 * Holds the full `ConfiguratorContext` in a `useReducer` store and exposes
 * `onUpdate`, `setUiMode`, `snapshot`, and `reset` to modules and the
 * playback shell.
 */
export function ModelBuilderContextProvider({
  initialContext,
  children,
}: ModelBuilderContextProviderProps) {
  const [context, dispatch] = useReducer(modelBuilderReducer, initialContext ?? {});

  const onUpdate = useCallback((updates: Partial<ConfiguratorContext>) => {
    dispatch({ type: "UPDATE", updates });
  }, []);

  const setUiMode = useCallback((mode: ModuleComplexity) => {
    dispatch({ type: "SET_UI_MODE", mode });
  }, []);

  const snapshot = useCallback((): ConfiguratorContext => {
    dispatch({ type: "SNAPSHOT" });
    return context;
  }, [context]);

  const reset = useCallback((nextState?: ConfiguratorContext) => {
    dispatch({ type: "RESET", initialState: nextState });
  }, []);

  const value = useMemo<ModelBuilderContextValue>(
    () => ({ context, onUpdate, setUiMode, snapshot, reset, dispatch }),
    [context, onUpdate, setUiMode, snapshot, reset]
  );

  return <ModelBuilderContext.Provider value={value}>{children}</ModelBuilderContext.Provider>;
}

export { ModelBuilderContext };
