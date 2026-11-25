/** `result-overview`'s view: the states it owes the user, rendered to a string. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@spatialhub/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

import resultOverview from "./index";
import {
  requestResultOverview,
  setResultOverviewGateway,
  type ResultOverviewGateway,
  type ResultOverviewSummary,
} from "./source";

const TITLE = "modelBuilder.result-overview.title";
const LOADING = "modelBuilder.result-overview.loading";
const FAILED = "modelBuilder.result-overview.failed";
const NO_GATEWAY = "modelBuilder.result-overview.noGateway";
const PRODUCTION = "modelBuilder.result-overview.production";
const LINK = "modelBuilder.result-overview.link";
const CONTINUE = "modelBuilder.result-overview.continue";
const BOTTOM_LOADING = "modelBuilder.result-overview.bottom.loading";
const BOTTOM_FAILED = "modelBuilder.result-overview.bottom.failed";
const BOTTOM_READY = "modelBuilder.result-overview.bottom.ready";
const BOTTOM_NO_GATEWAY = "modelBuilder.result-overview.bottom.noGateway";

const SUMMARY: ResultOverviewSummary = {
  carriers: ["power", "heat"],
  locationCount: 4,
  sumProduction: 1000,
  sumConsumption: 900,
  peakDemand: 5,
  timestepCount: 24,
};

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Render one region with the view's current state. */
function render(region: "sidebar" | "bottom", modelId = 1): string {
  return renderToStaticMarkup(
    <resultOverview.Component
      nodeId="result-overview"
      region={region}
      data={{ modelId, memeRun: { framework: "calliope", status: "completed" } }}
      run={async () => {}}
    />,
  );
}

/** Put the slot into the results state for `modelId`. */
async function withResults(modelId: number): Promise<void> {
  const gateway: ResultOverviewGateway = { async summary() { return SUMMARY; } };
  setResultOverviewGateway(gateway);
  requestResultOverview(modelId);
  await settle();
}

beforeEach(() => {
  setResultOverviewGateway(null);
});

describe("result-overview's sidebar", () => {
  it("reports a missing gateway with the installer's name", () => {
    const html = render("sidebar");

    expect(html).toContain(TITLE);
    expect(html).toContain(NO_GATEWAY);
    // With nothing to show, there is no summary and no link.
    expect(html).not.toContain(PRODUCTION);
    expect(html).not.toContain(LINK);
  });

  it("shows loading while the summary is owed", () => {
    setResultOverviewGateway({ summary: () => new Promise(() => {}) });
    requestResultOverview(1);

    const html = render("sidebar");
    expect(html).toContain(LOADING);
    expect(html).not.toContain(LINK);
  });

  it("reports a failed fetch, not an empty summary", async () => {
    setResultOverviewGateway({ summary: () => Promise.reject(new Error("no")) });
    requestResultOverview(1);
    await settle();

    const html = render("sidebar");
    expect(html).toContain(FAILED);
    expect(html).not.toContain(LINK);
  });

  it("shows the summary and a link to the full results page", async () => {
    await withResults(1);

    const html = render("sidebar", 1);
    expect(html).toContain(PRODUCTION);
    expect(html).toContain("1,000"); // the production total, grouped
    expect(html).toContain(LINK);
    expect(html).toContain('href="/app/model-results/1"');
    // The one control an interactive step carries: its forward action.
    expect(html).toContain(CONTINUE);
  });
});

describe("result-overview's status strip", () => {
  it("names the node and says the fetch is loading", () => {
    setResultOverviewGateway({ summary: () => new Promise(() => {}) });
    requestResultOverview(1);

    const html = render("bottom");
    expect(html).toContain("result-overview");
    expect(html).toContain(BOTTOM_LOADING);
  });

  it("says the summary is unavailable when the fetch failed", async () => {
    setResultOverviewGateway({ summary: () => Promise.reject(new Error("no")) });
    requestResultOverview(1);
    await settle();

    expect(render("bottom")).toContain(BOTTOM_FAILED);
  });

  it("says there is no gateway when the host installed none", () => {
    expect(render("bottom")).toContain(BOTTOM_NO_GATEWAY);
  });

  it("reports the carriers once the summary has arrived", async () => {
    await withResults(1);

    expect(render("bottom", 1)).toContain(BOTTOM_READY);
  });
});
