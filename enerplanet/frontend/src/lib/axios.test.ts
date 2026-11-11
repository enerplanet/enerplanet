import { afterEach, describe, expect, it, vi } from "vitest";
import { AxiosError, type AxiosAdapter, type InternalAxiosRequestConfig } from "axios";

import axios from "./axios";

/** An adapter answering each request with the next status in turn. */
function answering(statuses: number[], retryAfter = "2"): { adapter: AxiosAdapter; calls: () => number } {
  let calls = 0;
  const adapter: AxiosAdapter = async (config: InternalAxiosRequestConfig) => {
    const status = statuses[Math.min(calls++, statuses.length - 1)];
    const response = { data: {}, status, statusText: "", headers: { "retry-after": retryAfter }, config };
    if (status >= 400) throw new AxiosError(`status ${status}`, undefined, config, null, response);
    return response;
  };
  return { adapter, calls: () => calls };
}

describe("axios on 429", () => {
  afterEach(() => vi.useRealTimers());

  it("waits Retry-After seconds and sends the request again", async () => {
    vi.useFakeTimers();
    const { adapter, calls } = answering([429, 200]);
    const request = axios.get("/models", { adapter });

    await vi.advanceTimersByTimeAsync(1999);
    expect(calls()).toBe(1);
    await vi.advanceTimersByTimeAsync(1);

    await expect(request).resolves.toMatchObject({ status: 200 });
    expect(calls()).toBe(2);
  });

  it("gives up after two retries", async () => {
    vi.useFakeTimers();
    const { adapter, calls } = answering([429], "1");
    const request = axios.get("/models", { adapter });
    const settled = expect(request).rejects.toMatchObject({ response: { status: 429 } });

    await vi.advanceTimersByTimeAsync(2000);

    await settled;
    expect(calls()).toBe(3);
  });
});
