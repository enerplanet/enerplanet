/** `run-meme-calliope`'s full-screen auto state, driven by the `memeRun` port. */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AutoRunState, MemeRun } from "@model-builder/core";

vi.mock("@spatialhub/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import runMemeCalliope from "./index";

const FAILED = "modelBuilder.run-meme-calliope.failed";
const RETRY = "modelBuilder.run-meme-calliope.retry";
const RUNNING = "modelBuilder.run-meme-calliope.running";
const DONE = "modelBuilder.run-meme-calliope.done";

/** A run record for the port. */
function run(status: MemeRun["status"], error?: string): MemeRun {
  return { framework: "calliope", status, ...(error === undefined ? {} : { error }) };
}

/** Render the overlay region with a given auto state and port value — the module's own view of the run. */
function render(auto: AutoRunState | undefined, memeRun?: MemeRun): string {
  return renderToStaticMarkup(
    <runMemeCalliope.Component
      nodeId="run-meme-calliope"
      region="overlay"
      data={memeRun === undefined ? {} : { memeRun }}
      run={async () => {}}
      {...(auto === undefined ? {} : { auto })}
    />,
  );
}

describe("run-meme-calliope's auto state view", () => {
  it("shows the run in progress, with no control at all", () => {
    const html = render({ state: "running", rerun: () => {} }, run("running"));

    expect(html).toContain(RUNNING);
    expect(html).not.toContain(RETRY);
  });

  it("shows the run done, with no control at all", () => {
    // `auto.state` is not the source: the `memeRun` port says the run finished.
    const html = render({ state: "running", rerun: () => {} }, run("completed"));

    expect(html).toContain(DONE);
    expect(html).not.toContain(RETRY);
  });

  it("surfaces the frame's own failure — e.g. no gateway — and the manual re-run, and nothing else", () => {
    const html = render({ state: "error", message: "backend said no", rerun: () => {} });

    expect(html).toContain(FAILED);
    expect(html).toContain("backend said no");
    // The one affordance an auto node has — and only on failure.
    expect(html).toContain(RETRY);
  });

  it("surfaces a failed run's stored message and the manual re-run", () => {
    const html = render({ state: "done", rerun: () => {} }, run("failed", "meme said no"));

    expect(html).toContain(FAILED);
    expect(html).toContain("meme said no");
    expect(html).toContain(RETRY);
  });

  it("renders nothing when the frame hands it no auto state (test mode)", () => {
    expect(render(undefined, run("running"))).toBe("");
  });
});
