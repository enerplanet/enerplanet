/**
 * A module is its own workspace: `npm install` here, then `npm test` — no app, no dev server, no build.
 *
 * The only outside thing it resolves is `@model-builder/core` (and `@spatialhub/i18n` for the UI), which
 * its `package.json` declares as `file:` dependencies, exactly the way the app declares `@spatialhub/*`.
 * That is what makes this directory work on its own.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.{ts,tsx}"],
  },
});
