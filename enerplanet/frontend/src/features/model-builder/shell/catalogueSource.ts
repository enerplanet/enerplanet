/**
 * The catalogue source the frame installs: `GET /technologies`, with the bundled defaults behind it.
 *
 * The module declares the slot (`modules/technologies/catalogue.ts`) and never learns which source it has. This
 * lives in the shell because a module may only depend on `@model-builder/core`, while the app's CSRF-aware
 * axios instance is the app's.
 *
 * **The fallback is the legacy's own.** Its catalogue loader tries the API and, on failure, reads
 * `/initial-data/techs/default_technologies.json` — a picker showing the shipped defaults is better than a
 * picker showing nothing, and the products are the same shape either way. Kept here rather than in the module
 * because it is a *data-loading* decision about this app's assets, which is exactly what a shell is for.
 */

import axios from "@/lib/axios";
import type { CatalogueProduct, CatalogueSource } from "../modules/technologies/catalogue";

/** Where the shipped catalogue lives when the API cannot serve one. */
const BUNDLED_CATALOGUE = "/initial-data/techs/default_technologies.json";

/** Long enough for a cold API, short enough that an unresponsive one falls through to the bundle. */
const CATALOGUE_TIMEOUT_MS = 20_000;

export const backendCatalogueSource: CatalogueSource = {
  async load(): Promise<readonly CatalogueProduct[]> {
    try {
      const response = await axios.get<{ data?: CatalogueProduct[] }>("/technologies", {
        timeout: CATALOGUE_TIMEOUT_MS,
      });
      const served = response.data?.data;
      if (Array.isArray(served) && served.length > 0) return served;
    } catch {
      // Fall through: a catalogue the API cannot serve is not a reason to show an empty picker.
    }

    const response = await fetch(BUNDLED_CATALOGUE);
    if (!response.ok) return [];
    const body = (await response.json()) as { technologies?: CatalogueProduct[] };
    return body.technologies ?? [];
  },
};
