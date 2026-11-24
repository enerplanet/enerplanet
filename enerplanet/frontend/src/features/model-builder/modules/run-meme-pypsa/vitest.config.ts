/** A module's own vitest config: run `npm test` in this directory, with no app or build. */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.{ts,tsx}"],
  },
});
