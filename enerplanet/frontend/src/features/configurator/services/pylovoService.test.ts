import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const get = vi.fn();
const post = vi.fn();
vi.mock("@/lib/axios", () => ({ default: { get, post } }));

const { pylovoService, polygonsToGeom, siteScope } = await import("./pylovoService");

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

describe("polygonsToGeom", () => {
  const open = [[12.95, 48.83], [12.96, 48.83], [12.96, 48.84]];

  it("closes an open ring, which PostGIS requires", () => {
    expect(polygonsToGeom([open])).toEqual({ type: "Polygon", coordinates: [[...open, open[0]]] });
  });

  it("returns a MultiPolygon for several rings", () => {
    expect(polygonsToGeom([open, open]).type).toBe("MultiPolygon");
  });
});

describe("siteScope", () => {
  it("names the site only for a site grid", () => {
    expect(siteScope({ meta: { mode: "site", site_id: 7, revision: 3 } })).toEqual({ site_id: 7, revision: 3 });
    expect(siteScope({ buildings: { type: "FeatureCollection", features: [] } })).toBeUndefined();
  });
});

describe("pylovoService.generateSiteGrid", () => {
  beforeEach(() => { get.mockReset(); post.mockReset(); vi.useFakeTimers(); });
  afterEach(() => vi.useRealTimers());

  const square = [[[12.95, 48.83], [12.96, 48.83], [12.96, 48.84]]];

  it("polls the job until it succeeds, then returns the site grid", async () => {
    post.mockResolvedValueOnce({ data: { data: { site_id: 7 } } });
    post.mockResolvedValueOnce({ data: { data: { job_id: 2, revision: 1, status: "queued" } } });
    get.mockResolvedValueOnce({ data: { data: { job_id: 2, revision: 1, status: "succeeded" } } });
    get.mockResolvedValueOnce({ data: { data: { meta: { mode: "site", site_id: 7, revision: 1 } } } });

    const result = pylovoService.generateSiteGrid("THD", square);
    await vi.runAllTimersAsync();

    expect(await result).toEqual({ meta: { mode: "site", site_id: 7, revision: 1 } });
    expect(get.mock.calls.map(c => c[0])).toEqual(["/v2/pylovo/sites/7/jobs/2", "/v2/pylovo/sites/7/grid"]);
  });

  it("rejects with the job's error when generation fails", async () => {
    post.mockResolvedValueOnce({ data: { data: { site_id: 7 } } });
    post.mockResolvedValueOnce({ data: { data: { job_id: 2, revision: 1, status: "failed", error: "no roads in site" } } });

    await expect(pylovoService.generateSiteGrid("THD", square)).rejects.toThrow("no roads in site");
    expect(get).not.toHaveBeenCalled();
  });
});
