import { useCallback, useRef, useState } from "react";
import { useModelStore } from "@/features/configurator/store/modelStore";

export interface MultiEditModeState {
  isMultiEdit: boolean;
  multiEditSelectedIds: Set<string>;
  multiEditFeaturesRef: React.MutableRefObject<Map<string, any>>;
  toggleMultiEdit: (v: boolean) => void;
  clearMultiEditSelection: () => void;
}

export const useMultiEditMode = (): MultiEditModeState => {
  const activeMode = useModelStore((s) => s.activeMode);
  const setActiveMode = useModelStore((s) => s.setActiveMode);
  const [multiEditSelectedIds, setMultiEditSelectedIds] = useState<Set<string>>(new Set());
  const multiEditFeaturesRef = useRef<Map<string, any>>(new Map());

  const isMultiEdit = activeMode === "multi-edit";

  const clearMultiEditSelection = useCallback(() => {
    multiEditFeaturesRef.current.forEach((f) => f.setStyle(undefined));
    multiEditFeaturesRef.current.clear();
    setMultiEditSelectedIds(new Set());
  }, []);

  const toggleMultiEdit = useCallback(
    (v: boolean) => {
      setActiveMode(v ? "multi-edit" : null);
      if (!v) {
        clearMultiEditSelection();
      }
    },
    [setActiveMode, clearMultiEditSelection]
  );

  return {
    isMultiEdit,
    multiEditSelectedIds,
    multiEditFeaturesRef,
    toggleMultiEdit,
    clearMultiEditSelection,
  };
};
