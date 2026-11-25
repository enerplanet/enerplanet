/**
 * The workflows API — its own group, isolated from the legacy model routes, read through the app-wide
 * CSRF-aware client. Every response is wrapped `{data: …}`, peeled by `unwrap`.
 */

import axios from "@/lib/axios";
import type { WorkflowDocument, WorkflowSummary } from "./types";

/** What a delete reports back: whether it happened, and how many sessions referenced the workflow. */
export interface WorkflowDeleteResult {
  deleted: boolean;
  sessions: number;
}

/** Peel the `{data: …}` envelope, tolerating an already-bare body. */
function unwrap<T>(body: unknown): T {
  if (body !== null && typeof body === "object" && "data" in body) {
    return (body as { data: T }).data;
  }
  return body as T;
}

class WorkflowService {
  private readonly baseURL = "/workflows";

  async list(): Promise<WorkflowSummary[]> {
    const response = await axios.get(this.baseURL);
    return unwrap<WorkflowSummary[]>(response.data) ?? [];
  }

  async get(id: string): Promise<WorkflowSummary> {
    const response = await axios.get(`${this.baseURL}/${encodeURIComponent(id)}`);
    return unwrap<WorkflowSummary>(response.data);
  }

  async create(document: WorkflowDocument): Promise<WorkflowSummary> {
    const response = await axios.post(this.baseURL, document);
    return unwrap<WorkflowSummary>(response.data);
  }

  async update(id: string, document: WorkflowDocument): Promise<WorkflowSummary> {
    const response = await axios.put(`${this.baseURL}/${encodeURIComponent(id)}`, document);
    return unwrap<WorkflowSummary>(response.data);
  }

  async remove(id: string): Promise<WorkflowDeleteResult> {
    const response = await axios.delete(`${this.baseURL}/${encodeURIComponent(id)}`);
    return unwrap<WorkflowDeleteResult>(response.data);
  }
}

export const workflowService = new WorkflowService();
export default workflowService;
