/**
 * `building-demand`'s full-screen auto state (T15) — in progress, done, or failed with a manual re-run.
 *
 * This module is the one `auto` node in the dev flow, so it is also the demonstration: it has no button to start
 * with, and the only control anywhere on it is the **manual re-run**, and only after a failure. The states are
 * rendered to a string (`@spatialhub/i18n` echoes the key) because the app has no DOM test environment.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AutoRunState } from "@model-builder/core";

vi.mock("@spatialhub/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import buildingDemand from "./index";

const FAILED = "modelBuilder.building-demand.failed";
const RETRY = "modelBuilder.building-demand.retry";
const RUNNING = "modelBuilder.building-demand.running";
const DONE = "modelBuilder.building-demand.done";

/** Render the overlay region with a given auto state — the module's own view of the run. */
function render(auto: AutoRunState | undefined): string {
  return renderToStaticMarkup(
    <buildingDemand.Component
      nodeId="building-demand"
      region="overlay"
      data={{}}
      run={async () => {}}
      {...(auto === undefined ? {} : { auto })}
    />,
  );
}

describe("building-demand's auto state view", () => {
  it("shows the run in progress, with no control at all", () => {
    const html = render({ state: "running", rerun: () => {} });

    expect(html).toContain(RUNNING);
    expect(html).not.toContain(RETRY);
  });

  it("shows the run done, with no control at all", () => {
    const html = render({ state: "done", rerun: () => {} });

    expect(html).toContain(DONE);
    expect(html).not.toContain(RETRY);
  });

  it("surfaces the failure and the manual re-run, and nothing else", () => {
    const html = render({ state: "error", message: "backend said no", rerun: () => {} });

    expect(html).toContain(FAILED);
    expect(html).toContain("backend said no");
    // The one affordance an auto node has — and only on failure.
    expect(html).toContain(RETRY);
  });

  it("renders nothing when the frame hands it no auto state (test mode)", () => {
    expect(render(undefined)).toBe("");
  });
});
