/**
 * The core is a standalone package: `cd` here, `npm install`, `npm test`. Nothing it contains imports
 * anything from the app, which is what lets a module depend on the core alone.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
  },
});
