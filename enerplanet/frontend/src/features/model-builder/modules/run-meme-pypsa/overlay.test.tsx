/**
 * `run-meme-pypsa`'s full-screen auto state — in progress, done, or failed with a manual re-run.
 *
 * The structure is `run-meme-calliope`'s: no control at all while the leg is in progress or done, and on
 * failure the message plus the **manual re-run** — the one affordance an auto node has. The states are rendered
 * to a string (`@spatialhub/i18n` echoes the key) because the app has no DOM test environment.
 *
 * As for the Calliope run, the *source* of the leg's state is the store's `memePypsaLeg` port — the frame's
 * `auto.state` describes its own `run()` call, which returns as soon as the leg is dispatched, minutes before it
 * finishes. So these cases hand the port the value under test and `auto` the guard and the rerun.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { AutoRunState, MemePypsaLeg } from "@model-builder/core";

vi.mock("@spatialhub/i18n", () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

import runMemePypsa from "./index";

const FAILED = "modelBuilder.run-meme-pypsa.failed";
const RETRY = "modelBuilder.run-meme-pypsa.retry";
const RUNNING = "modelBuilder.run-meme-pypsa.running";
const DONE = "modelBuilder.run-meme-pypsa.done";

/** A leg record for the port. */
function leg(status: MemePypsaLeg["status"], error?: string): MemePypsaLeg {
  return { framework: "pypsa", status, ...(error === undefined ? {} : { error }) };
}

/** Render the overlay region with a given auto state and port value — the module's own view of the leg. */
function render(auto: AutoRunState | undefined, memePypsaLeg?: MemePypsaLeg): string {
  return renderToStaticMarkup(
    <runMemePypsa.Component
      nodeId="run-meme-pypsa"
      region="overlay"
      data={memePypsaLeg === undefined ? {} : { memePypsaLeg }}
      run={async () => {}}
      {...(auto === undefined ? {} : { auto })}
    />,
  );
}

describe("run-meme-pypsa's auto state view", () => {
  it("shows the leg in progress, with no control at all", () => {
    const html = render({ state: "running", rerun: () => {} }, leg("running"));

    expect(html).toContain(RUNNING);
    expect(html).not.toContain(RETRY);
  });

  it("shows the leg done, with no control at all", () => {
    // `auto.state` is not the source: it reads `done` the moment the dispatch returns, while the leg is still
    // going. The port is what says the leg finished.
    const html = render({ state: "running", rerun: () => {} }, leg("completed"));

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

  it("surfaces a failed leg's stored message and the manual re-run", () => {
    const html = render({ state: "done", rerun: () => {} }, leg("failed", "meme said no"));

    expect(html).toContain(FAILED);
    expect(html).toContain("meme said no");
    expect(html).toContain(RETRY);
  });

  it("renders nothing when the frame hands it no auto state (test mode)", () => {
    expect(render(undefined, leg("running"))).toBe("");
  });
});
