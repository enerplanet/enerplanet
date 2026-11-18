/**
 * The workflows header's link to the example modules. It is an external link, so what matters is
 * that it carries the GitHub URL and opens in a new tab.
 *
 * `@spatialhub/i18n` is stubbed to echo the fallback, as `WorkflowEditor.test.tsx` does, so the assertion is
 * about the link rather than about copy. The page reads through `workflowService`; the fetch runs in an
 * effect, which a static render never executes, but the module is stubbed so no HTTP client is constructed.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@spatialhub/i18n", () => ({
  useTranslation: () => ({
    t: (key: string, fallback?: string) => fallback ?? key,
  }),
}));

vi.mock("./service", () => ({
  workflowService: { list: vi.fn().mockResolvedValue([]) },
  default: { list: vi.fn().mockResolvedValue([]) },
}));

import WorkflowsPage from "./WorkflowsPage";

const EXAMPLES_URL =
  "https://github.com/enerplanet/enerplanet/tree/main/enerplanet/frontend/src/features/model-builder/modules/examples";

describe("the workflows header", () => {
  it("links to the example modules in a new tab", () => {
    const html = renderToStaticMarkup(<WorkflowsPage />);

    expect(html).toContain(`href="${EXAMPLES_URL}"`);
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noreferrer"');
    expect(html).toContain("Build your own module");
  });

  it("offers a New subflow action beside New workflow", () => {
    const html = renderToStaticMarkup(<WorkflowsPage />);

    expect(html).toContain("New workflow");
    expect(html).toContain("New subflow");
  });
});
