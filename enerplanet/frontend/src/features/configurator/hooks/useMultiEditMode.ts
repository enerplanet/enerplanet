import { useCallback, useRef, useState } from "react";

export interface MultiEditModeState {
  isMultiEdit: boolean;
  multiEditSelectedIds: Set<string>;
  multiEditFeaturesRef: React.MutableRefObject<Map<string, any>>;
  toggleMultiEdit: (v: boolean) => void;
  clearMultiEditSelection: () => void;
}

export const useMultiEditMode = (): MultiEditModeState => {
  const [isMultiEdit, setIsMultiEdit] = useState(false);
  const [multiEditSelectedIds, setMultiEditSelectedIds] = useState<Set<string>>(new Set());
  const multiEditFeaturesRef = useRef<Map<string, any>>(new Map());

  const clearMultiEditSelection = useCallback(() => {
    multiEditFeaturesRef.current.forEach((f) => f.setStyle(undefined));
    multiEditFeaturesRef.current.clear();
    setMultiEditSelectedIds(new Set());
  }, []);

  const toggleMultiEdit = useCallback(
    (v: boolean) => {
      setIsMultiEdit(v);
      if (!v) {
        clearMultiEditSelection();
      }
    },
    [clearMultiEditSelection]
  );

  return {
    isMultiEdit,
    multiEditSelectedIds,
    multiEditFeaturesRef,
    toggleMultiEdit,
    clearMultiEditSelection,
  };
};
