/**
 * `compare-variant`'s view — rendered to a string, because the app has no DOM test environment.
 *
 * The point is the states the view owes the user — loading, both sides with results, a side with none (the
 * common case right after the variant was made), and a failed fetch — plus the no-gateway error that names the
 * installer, and the one control an interactive step must carry: the forward action. `t` echoes its key and the
 * source slot's state is driven through its own functions, so no DOM or fetch is involved.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ModelData } from "@model-builder/core";

vi.mock("@spatialhub/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key, i18n: { language: "en" } }),
}));

import compareVariant from "./index";
import {
  requestCompareVariant,
  setCompareVariantGateway,
  type CompareVariantGateway,
  type CompareVariantSummary,
} from "./source";

const TITLE = "modelBuilder.compare-variant.title";
const CONTINUE = "modelBuilder.compare-variant.continue";
const BASELINE = "modelBuilder.compare-variant.baseline";
const COMPARISON = "modelBuilder.compare-variant.comparison";
const PRODUCTION = "modelBuilder.compare-variant.production";
const NOT_RUN = "modelBuilder.compare-variant.notRun";
const LOADING = "modelBuilder.compare-variant.loading";
const FAILED = "modelBuilder.compare-variant.failed";
const NO_GATEWAY = "modelBuilder.compare-variant.noGateway";
const NO_VARIANT = "modelBuilder.compare-variant.noVariant";
const LINK = "modelBuilder.compare-variant.link";
const BOTTOM_LOADING = "modelBuilder.compare-variant.bottom.loading";
const BOTTOM_FAILED = "modelBuilder.compare-variant.bottom.failed";
const BOTTOM_NO_GATEWAY = "modelBuilder.compare-variant.bottom.noGateway";
const BOTTOM_READY = "modelBuilder.compare-variant.bottom.ready";
const BOTTOM_PARTIAL = "modelBuilder.compare-variant.bottom.partial";

const SUMMARY: CompareVariantSummary = {
  sumProduction: 1000,
  sumConsumption: 900,
  peakDemand: 5,
};

/** The mock projection: a recorded variant, which is what the node requires. */
const WITH_VARIANT: ModelData = {
  modelVariant: { variantModelId: 11, rootModelId: 1, title: "Base v1" },
};

const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Render one region with the view's current state. */
function render(region: "sidebar" | "bottom", data: ModelData = WITH_VARIANT): string {
  return renderToStaticMarkup(
    <compareVariant.Component
      nodeId="compare-variant"
      region={region}
      data={data}
      run={async () => {}}
    />,
  );
}

/** Install a gateway and drive the slot into a resolved state for the pair. */
async function withResults(answer: (modelId: number) => CompareVariantSummary | null): Promise<void> {
  const gateway: CompareVariantGateway = { async summary(modelId) { return answer(modelId); } };
  setCompareVariantGateway(gateway);
  requestCompareVariant(1, 11);
  await settle();
}

beforeEach(() => {
  setCompareVariantGateway(null);
});

describe("compare-variant's sidebar", () => {
  it("reports a missing gateway with the installer's name", () => {
    const html = render("sidebar");

    expect(html).toContain(TITLE);
    expect(html).toContain(NO_GATEWAY);
    // With nothing to show, there is no comparison and no link.
    expect(html).not.toContain(PRODUCTION);
    expect(html).not.toContain(LINK);
  });

  it("says there is nothing to compare when no variant has been made", () => {
    const html = render("sidebar", { modelId: 1 });

    expect(html).toContain(NO_VARIANT);
    expect(html).not.toContain(LINK);
  });

  it("shows loading while both sides are owed", () => {
    setCompareVariantGateway({ summary: () => new Promise(() => {}) });
    requestCompareVariant(1, 11);

    const html = render("sidebar");
    expect(html).toContain(LOADING);
    expect(html).not.toContain(LINK);
  });

  it("reports a failed fetch, not an empty comparison", async () => {
    setCompareVariantGateway({ summary: () => Promise.reject(new Error("no")) });
    requestCompareVariant(1, 11);
    await settle();

    const html = render("sidebar");
    expect(html).toContain(FAILED);
    expect(html).not.toContain(LINK);
  });

  it("shows both sides and a link that seeds the compare page from the family's two ids", async () => {
    await withResults(() => SUMMARY);

    const html = render("sidebar");
    expect(html).toContain(BASELINE);
    expect(html).toContain(COMPARISON);
    expect(html).toContain(PRODUCTION);
    expect(html).toContain("1,000"); // the production total, grouped
    // The `&` is HTML-escaped in the static markup; the href is the compare page's own two query params.
    expect(html).toContain('href="/app/simulation-reports?model1=1&amp;model2=11"');
    expect(html).toContain(LINK);
    // The one control an interactive step carries: its forward action.
    expect(html).toContain(CONTINUE);
  });

  it("names the variant as not run when only the root has results — the common case", async () => {
    // The endpoint answers a freshly made variant with no data.
    await withResults((modelId) => (modelId === 11 ? null : SUMMARY));

    const html = render("sidebar");
    expect(html).toContain(PRODUCTION); // the root's side is shown
    expect(html).toContain(NOT_RUN); // and the variant is named, not shown as a zero
    expect(html).toContain(LINK);
  });
});

describe("compare-variant's status strip", () => {
  it("says there is no gateway when the host installed none", () => {
    expect(render("bottom")).toContain(BOTTOM_NO_GATEWAY);
  });

  it("says the fetch is loading", () => {
    setCompareVariantGateway({ summary: () => new Promise(() => {}) });
    requestCompareVariant(1, 11);

    const html = render("bottom");
    expect(html).toContain("compare-variant");
    expect(html).toContain(BOTTOM_LOADING);
  });

  it("says the comparison is unavailable when the fetch failed", async () => {
    setCompareVariantGateway({ summary: () => Promise.reject(new Error("no")) });
    requestCompareVariant(1, 11);
    await settle();

    expect(render("bottom")).toContain(BOTTOM_FAILED);
  });

  it("reports both sides ready", async () => {
    await withResults(() => SUMMARY);

    expect(render("bottom")).toContain(BOTTOM_READY);
  });

  it("reports one side not yet run", async () => {
    await withResults((modelId) => (modelId === 11 ? null : SUMMARY));

    expect(render("bottom")).toContain(BOTTOM_PARTIAL);
  });
});
