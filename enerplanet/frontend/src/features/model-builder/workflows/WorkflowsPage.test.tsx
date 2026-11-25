/** The workflows header's link to the example modules: that it carries the GitHub URL and opens in a new tab. */
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
