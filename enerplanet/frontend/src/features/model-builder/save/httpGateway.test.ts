/**
 * The HTTP adapter — endpoint paths and payload keys are the kind of thing that breaks silently, so
 * they are pinned here against a recording client.
 *
 * Written failing first.
 */
import { describe, it, expect } from "vitest";
import { createHttpGateway, type HttpClient } from "./httpGateway";
import type { Artefact } from "../core/artefact";
import type { LegacyModelPayload } from "./gateway";

interface Call {
  method: "post" | "put" | "get";
  url: string;
  body?: unknown;
}

function fakeClient(handler: (call: Call) => unknown): { client: HttpClient; calls: Call[] } {
  const calls: Call[] = [];

  const respond = <T,>(call: Call): Promise<{ data: T }> => {
    calls.push(call);
    const result = handler(call);
    if (result instanceof Error) return Promise.reject(result);
    return Promise.resolve({ data: result as T });
  };

  return {
    calls,
    client: {
      post: <T,>(url: string, body?: unknown) => respond<T>({ method: "post", url, body }),
      put: <T,>(url: string, body?: unknown) => respond<T>({ method: "put", url, body }),
      get: <T,>(url: string) => respond<T>({ method: "get", url }),
    },
  };
}

const PAYLOAD: LegacyModelPayload = {
  title: "Demo",
  from_date: "2025-01-01",
  to_date: "2025-12-31",
  resolution: 60,
  coordinates: { type: "MultiPolygon", coordinates: [] },
  config: {},
  status: "incomplete",
};

function artefact(): Artefact {
  return {
    version: 1,
    workflow: { id: "wf-core", version: 3 },
    modelId: 7,
    initial: {},
    projection: { modelName: "Demo" },
    log: [{ revision: 1, primary: [], cascade: [] }],
    discarded: [],
    cursor: 1,
    fingerprint: "fp-abc",
  };
}

describe("httpGateway — Call A", () => {
  it("creates through the legacy endpoint and returns the id the envelope carries", async () => {
    const { client, calls } = fakeClient(() => ({ data: { id: 7 } }));

    const created = await createHttpGateway(client).createModel(PAYLOAD);

    expect(calls).toEqual([{ method: "post", url: "/models", body: PAYLOAD }]);
    expect(created).toEqual({ modelId: 7 });
  });

  it("refuses a create whose envelope carries no id", async () => {
    const { client } = fakeClient(() => ({ data: {} }));

    await expect(createHttpGateway(client).createModel(PAYLOAD)).rejects.toThrow(/no ID/);
  });

  it("finalises the draft's transformers and claims its series after a create", async () => {
    const { client, calls } = fakeClient((call) =>
      call.url === "/models" ? { data: { id: 7 } } : {},
    );

    await createHttpGateway(client).createModel(PAYLOAD, { draftId: "draft-1", userId: "u-1" });

    expect(calls.map((call) => call.url)).toEqual([
      "/models",
      "/v1/pylovo/finalize-transformers",
      "/models/7/series/claim-draft",
    ]);
    expect(calls[1].body).toEqual({ draft_id: "draft-1", model_id: 7, user_id: "u-1" });
    expect(calls[2].body).toEqual({ draft_id: "draft-1" });
  });

  it("keeps the model when a draft side-effect fails — both are non-fatal legacy steps", async () => {
    const { client } = fakeClient((call) => {
      if (call.url === "/models") return { data: { id: 7 } };
      return new Error("pylovo is down");
    });

    await expect(
      createHttpGateway(client).createModel(PAYLOAD, { draftId: "draft-1", userId: "u-1" }),
    ).resolves.toEqual({ modelId: 7 });
  });

  it("keeps no side-effects when there is no draft", async () => {
    const { client, calls } = fakeClient(() => ({ data: { id: 7 } }));

    await createHttpGateway(client).createModel(PAYLOAD, { userId: "u-1" }); // no draftId

    expect(calls.map((call) => call.url)).toEqual(["/models"]);
  });

  it("updates through the legacy endpoint", async () => {
    const { client, calls } = fakeClient(() => ({}));

    await createHttpGateway(client).updateModel(7, PAYLOAD);

    expect(calls).toEqual([{ method: "put", url: "/models/7", body: PAYLOAD }]);
  });
});

describe("httpGateway — Call B", () => {
  it("sends the artefact to the session endpoint under its wire names", async () => {
    const { client, calls } = fakeClient(() => ({}));

    await createHttpGateway(client).saveSession(7, artefact(), { id: "wf-core", version: 3 });

    expect(calls[0].method).toBe("put");
    expect(calls[0].url).toBe("/models/7/session");
    expect(calls[0].body).toEqual({
      workflow_id: "wf-core",
      workflow_version: 3,
      initial: {},
      projection: { modelName: "Demo" },
      log: [{ revision: 1, primary: [], cascade: [] }],
      discarded: [],
      cursor: 1,
      fingerprint: "fp-abc",
    });
  });

  it("reads a session back into an artefact", async () => {
    const { client, calls } = fakeClient(() => ({
      data: {
        model_id: 7,
        workflow_id: "wf-core",
        workflow_version: 3,
        initial: {},
        projection: { modelName: "Demo" },
        log: [{ revision: 1, primary: [], cascade: [] }],
        discarded: [],
        cursor: 1,
        fingerprint: "fp-abc",
      },
    }));

    const loaded = await createHttpGateway(client).loadSession(7);

    expect(calls).toEqual([{ method: "get", url: "/models/7/session" }]);
    expect(loaded).toEqual(artefact());
  });

  it("treats 404 as 'no session', not as a failure", async () => {
    const { client } = fakeClient(() => Object.assign(new Error("Not Found"), { response: { status: 404 } }));

    await expect(createHttpGateway(client).loadSession(7)).resolves.toBeUndefined();
  });

  it("lets a real error through", async () => {
    const { client } = fakeClient(() => Object.assign(new Error("Boom"), { response: { status: 500 } }));

    await expect(createHttpGateway(client).loadSession(7)).rejects.toThrow(/Boom/);
  });
});
