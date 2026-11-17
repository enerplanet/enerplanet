/** The 3D view's building under a map pixel, and its hover tint, for code outside the overlay such as tech drops. */
export interface BuildingPicker3D {
  /** osm_id of the building drawn at the pixel (relative to the map element), or null. */
  buildingAt: (pixel: [number, number]) => string | null;
  /** Tints the building with this osm_id, or none for null. */
  highlight: (osmId: string | null) => void;
}

// One shared holder: only one 3D overlay is mounted at a time.
/** Set while a 3D overlay is shown, null otherwise. */
export const buildingPicker3D: { current: BuildingPicker3D | null } = { current: null };
