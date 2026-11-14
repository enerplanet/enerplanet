/**
 * The modules the shell hosts.
 *
 * A **manual, hand-written list** — deliberately, and only for now. Modules are built one at a time in
 * isolation, so a registry they are added to by hand is honest about where the project is: there is no
 * workflow to resolve them from yet. Adding a module is an import and an entry; nothing else in the
 * feature has to change.
 *
 * One entry per line, so `scripts/new-module.mjs` can splice a new module in without guessing.
 */

import type { BuilderModule } from "./contract";
import example from "../modules/example";

export const MODULES: readonly BuilderModule[] = [
  example,
];
