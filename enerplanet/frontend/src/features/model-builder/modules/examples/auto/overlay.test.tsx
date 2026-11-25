/** `example-auto`'s full-screen auto state: running, done, or failed with a manual re-run. */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AutoRunState } from "@model-builder/core";

vi.mock("@spatialhub/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import exampleAuto from "./index";

const FAILED = "modelBuilder.example-auto.failed";
const RETRY = "modelBuilder.example-auto.retry";
const RUNNING = "modelBuilder.example-auto.running";
const DONE = "modelBuilder.example-auto.done";

/** Render the overlay region with a given auto state — the module's own view of the run. */
function render(auto: AutoRunState | undefined): string {
  return renderToStaticMarkup(
    <exampleAuto.Component
      nodeId="example-auto"
      region="overlay"
      data={{}}
      run={async () => {}}
      {...(auto === undefined ? {} : { auto })}
    />,
  );
}

describe("example-auto's auto state view", () => {
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
