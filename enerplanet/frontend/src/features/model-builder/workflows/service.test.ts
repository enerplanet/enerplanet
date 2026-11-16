/**
 * The workflows API client (plan §5). These pin the routes, the method-per-call, and the `{data: …}`
 * envelope — the contract the backend is built against in parallel, so the client must not drift from it.
 *
 * Written failing first.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const get = vi.fn();
const post = vi.fn();
const put = vi.fn();
const del = vi.fn();
vi.mock("@/lib/axios", () => ({ default: { get, post, put, delete: del } }));

const { workflowService } = await import("./service");
import type { WorkflowSummary } from "./types";

const summary: WorkflowSummary = {
  workflow_id: "dev-flow",
  version: 1,
  label: "Development flow",
  definition: { id: "dev-flow", version: 1, label: "Development flow", nodes: [] },
  is_default: true,
};

beforeEach(() => {
  get.mockReset();
  post.mockReset();
  put.mockReset();
  del.mockReset();
});

describe("the workflows API client", () => {
  it("lists workflows and unwraps the data envelope", async () => {
    get.mockResolvedValueOnce({ data: { data: [summary] } });

    await expect(workflowService.list()).resolves.toEqual([summary]);
    expect(get).toHaveBeenCalledWith("/workflows");
  });

  it("returns an empty list when the server sends none", async () => {
    get.mockResolvedValueOnce({ data: { data: [] } });
    await expect(workflowService.list()).resolves.toEqual([]);
  });

  it("reads one workflow by its id", async () => {
    get.mockResolvedValueOnce({ data: { data: summary } });

    await expect(workflowService.get("dev-flow")).resolves.toEqual(summary);
    expect(get).toHaveBeenCalledWith("/workflows/dev-flow");
  });

  it("creates by posting the document", async () => {
    post.mockResolvedValueOnce({ data: { data: summary } });

    await workflowService.create(summary.definition);
    expect(post).toHaveBeenCalledWith("/workflows", summary.definition);
  });

  it("updates by putting the document at the id, url-encoded", async () => {
    put.mockResolvedValueOnce({ data: { data: summary } });

    await workflowService.update("dev flow", summary.definition);
    expect(put).toHaveBeenCalledWith("/workflows/dev%20flow", summary.definition);
  });

  it("reports how many sessions referenced a deleted workflow", async () => {
    del.mockResolvedValueOnce({ data: { data: { deleted: true, sessions: 3 } } });

    await expect(workflowService.remove("dev-flow")).resolves.toEqual({ deleted: true, sessions: 3 });
    expect(del).toHaveBeenCalledWith("/workflows/dev-flow");
  });
});
