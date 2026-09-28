import { beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
vi.mock("@/lib/axios", () => ({ default: { get } }));

const { pylovoService } = await import("./pylovoService");

const regions = { status: "success", regions: [{ country_code: "NL", grid_count: 44 }] };

describe("pylovoService.getAvailableRegions", () => {
  beforeEach(() => get.mockReset());

  it("asks again after a failed answer instead of serving it from the cache", async () => {
    get.mockResolvedValueOnce({ data: {} });
    get.mockResolvedValueOnce({ data: { data: regions } });

    const first = await pylovoService.getAvailableRegions();
    const second = await pylovoService.getAvailableRegions();

    expect(first.status).toBe("error");
    expect(second).toEqual(regions);
    expect(get).toHaveBeenCalledTimes(2);
  });
});
