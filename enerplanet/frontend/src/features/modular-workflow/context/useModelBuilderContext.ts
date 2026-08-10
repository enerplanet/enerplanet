import { useContext } from "react";
import {
  ModelBuilderContext,
  type ModelBuilderContextValue,
} from "./ModelBuilderContext";

/**
 * Access the shared workflow context from within a module component or the
 * playback shell.
 *
 * Returns `{ context, onUpdate, setUiMode, snapshot, reset }` (plus the raw
 * `dispatch`). Throws if used outside of a `ModelBuilderContextProvider`.
 */
export function useModelBuilderContext(): ModelBuilderContextValue {
  const value = useContext(ModelBuilderContext);
  if (!value) {
    throw new Error(
      "useModelBuilderContext must be used within a ModelBuilderContextProvider",
    );
  }
  return value;
}
