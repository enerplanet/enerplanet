/**
 * Logical defaults per slice (Plan P1, README Aspect 6).
 * Non-expert users never need to touch these; they make a blank context valid.
 */
import type {
  DemandSlice,
  GridSlice,
  ModelContext,
  ModelMeta,
  PypsaSlice,
  RegionSlice,
  TechSlice,
  UserDataSlice,
} from "./types";

export function getDefaultMeta(): ModelMeta {
  return {
    title: "Untitled model",
    resolution: "1h",
  };
}

export function getDefaultRegion(): RegionSlice {
  return {};
}

export function getDefaultGrid(): GridSlice {
  return { buildings: [], lines: [], mvLines: [], transformers: [] };
}

export function getDefaultDemand(): DemandSlice {
  return { entries: {} };
}

export function getDefaultTech(): TechSlice {
  return { assignments: {} };
}

export function getDefaultPypsa(): PypsaSlice {
  return {};
}

export function getDefaultUserData(): UserDataSlice {
  return { timeseries: [], locationIds: [] };
}

/** Blank context: starting point of every `null`-start workflow. */
export function createEmptyContext(): ModelContext {
  return {
    schemaVersion: 1,
    revision: 0,
    status: "draft",
    meta: getDefaultMeta(),
    region: getDefaultRegion(),
    grid: getDefaultGrid(),
    demand: getDefaultDemand(),
    techAssignments: getDefaultTech(),
    pypsa: getDefaultPypsa(),
    userData: getDefaultUserData(),
    history: [],
    undoStack: [],
    redoStack: [],
  };
}
