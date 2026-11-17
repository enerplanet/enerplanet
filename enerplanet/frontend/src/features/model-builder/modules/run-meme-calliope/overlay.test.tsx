/**
 * `run-meme-calliope`'s full-screen auto state (T15) — in progress, done, or failed with a manual re-run.
 *
 * The structure is `building-demand`'s: no control at all while the run is in progress or done, and on failure
 * the message plus the **manual re-run** — the one affordance an auto node has. The states are rendered to a
 * string (`@spatialhub/i18n` echoes the key) because the app has no DOM test environment.
 *
 * The one difference from `building-demand`'s view is the *source* of the run's state: that one reads it off
 * `auto.state`, while this node's progress lives in the store's `memeRun` port — the frame's `auto.state`
 * describes its own `run()` call, which returns as soon as the run is dispatched, minutes before it finishes.
 * So these cases hand the port the value under test and `auto` the guard and the rerun.
 */
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
    // `auto.state` is not the source: it reads `done` the moment the dispatch returns, while the run is still
    // going. The port is what says the run finished.
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
