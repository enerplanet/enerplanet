/**
 * `model-variant`'s view — rendered to a string, because the app has no DOM test environment.
 *
 * The point is the two states the sidebar owes the user: the form before a variant exists (its forward action),
 * and what the switch did afterwards — this page is now on the copy (its title and id), and the root id the
 * comparison reads as its baseline. There is no link: the page is not left. The status strip is pinned for the
 * same two states. `t` echoes its key, so no i18n or DOM is involved.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ModelData } from "@model-builder/core";

vi.mock("@spatialhub/i18n", () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

import modelVariant from "./index";

const TITLE = "modelBuilder.model-variant.title";
const CREATE = "modelBuilder.model-variant.create";
const CONTINUE = "modelBuilder.model-variant.continue";
const SWITCHED_TO = "modelBuilder.model-variant.switchedTo";
const ROOT_LABEL = "modelBuilder.model-variant.rootLabel";
const BOTTOM_NOT_SET = "modelBuilder.model-variant.bottom.notSet";
const BOTTOM_READY = "modelBuilder.model-variant.bottom.ready";

/** Render one region with the given projection. */
function render(region: "sidebar" | "bottom", data: ModelData): string {
  return renderToStaticMarkup(
    <modelVariant.Component
      nodeId="model-variant"
      region={region}
      data={data}
      run={async () => {}}
    />,
  );
}

describe("model-variant's sidebar", () => {
  it("offers the action that creates the variant when none exists yet", () => {
    const html = render("sidebar", { modelId: 1 });

    expect(html).toContain(TITLE);
    expect(html).toContain(CREATE);
    // Nothing has been made, so there is no result panel.
    expect(html).not.toContain(SWITCHED_TO);
    expect(html).not.toContain(ROOT_LABEL);
  });

  it("states that this page is now on the copy, and names the root the comparison will use", () => {
    const html = render("sidebar", {
      modelId: 42,
      modelVariant: { variantModelId: 42, rootModelId: 91, title: "Base v1" },
    });

    expect(html).toContain(SWITCHED_TO);
    expect(html).toContain("Base v1");
    // The copy's own id, and the family's root — the id the comparison reads as its baseline.
    expect(html).toContain("42");
    expect(html).toContain(ROOT_LABEL);
    expect(html).toContain("91");
    // The page is not navigated away from: no anchor to another builder load.
    expect(html).not.toContain("<a ");
    // The forward action remains, now to be left behind; it no longer offers to create.
    expect(html).toContain(CONTINUE);
    expect(html).not.toContain(CREATE);
  });
});

describe("model-variant's status strip", () => {
  it("names the node and says no variant has been made", () => {
    const html = render("bottom", { modelId: 1 });

    expect(html).toContain("model-variant");
    expect(html).toContain(BOTTOM_NOT_SET);
  });

  it("reports the variant once one has been made", () => {
    const html = render("bottom", {
      modelId: 11,
      modelVariant: { variantModelId: 11, rootModelId: 1 },
    });

    expect(html).toContain(BOTTOM_READY);
  });
});
