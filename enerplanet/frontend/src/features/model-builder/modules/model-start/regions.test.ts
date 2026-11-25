/** `model-start`'s region slot: the list comes from the source, and a failure is reported as one. */
import { describe, expect, it } from "vitest";
import {
  loadRegions,
  optionFor,
  optionsFor,
  regionKey,
  regionsState,
  setRegionSource,
  type RegionOption,
} from "./regions";

/** The port's fields, named once so the cases and the fixtures agree. */
const DE = "DE";
const NL = "NL";
const BW = "BW";
const ZH = "ZH";

const BADEN_WUERTTEMBERG: RegionOption = {
  country: DE,
  state: BW,
  label: "Baden-Württemberg",
  bounds: [7.5, 47.5, 10.5, 49.8],
};

describe("model-start's region slot", () => {
  it("offers the regions the source answers with", async () => {
    setRegionSource({ listRegions: () => Promise.resolve([BADEN_WUERTTEMBERG]) });

    await loadRegions();

    expect(regionsState()).toEqual({
      regions: [BADEN_WUERTTEMBERG],
      loading: false,
      failed: false,
    });
  });

  it("reports a failed load as a failure, not an empty list", async () => {
    setRegionSource({ listRegions: () => Promise.reject(new Error("backend down")) });

    await loadRegions();

    expect(regionsState()).toEqual({ regions: [], loading: false, failed: true });
  });

  it("asks as soon as a source is installed, rather than waiting for a region to mount", async () => {
    // Child effects run before the parent's, so the mount-time load must ask the shell to install the source.
    let asked = 0;
    setRegionSource({
      listRegions: () => {
        asked += 1;
        return Promise.resolve([BADEN_WUERTTEMBERG]);
      },
    });

    expect(asked).toBe(1);

    await Promise.resolve();
    await Promise.resolve();
    expect(regionsState().regions).toEqual([BADEN_WUERTTEMBERG]);
  });

  it("asks the source once when both regions mount together", async () => {
    let calls = 0;
    let settle: (regions: readonly RegionOption[]) => void = () => {};
    const pending = new Promise<readonly RegionOption[]>((resolve) => {
      settle = resolve;
    });
    setRegionSource({
      listRegions: () => {
        calls += 1;
        return pending;
      },
    });

    const first = loadRegions();
    const second = loadRegions();
    expect(calls).toBe(1);

    settle([BADEN_WUERTTEMBERG]);
    await Promise.all([first, second]);

    expect(calls).toBe(1);
    expect(regionsState().regions).toEqual([BADEN_WUERTTEMBERG]);
  });

  it("says nothing is loading when no source is installed", async () => {
    setRegionSource(null);

    await loadRegions();

    expect(regionsState()).toEqual({ regions: [], loading: false, failed: false });
  });
});

describe("the picker's helpers", () => {
  it("keys a region by the port's two fields", () => {
    expect(regionKey({ country: DE, state: BW })).toBe(`${DE}-${BW}`);
  });

  it("finds the option for a stored region, and nothing for one that is gone", () => {
    expect(optionFor([BADEN_WUERTTEMBERG], { country: DE, state: BW })).toBe(BADEN_WUERTTEMBERG);
    expect(optionFor([BADEN_WUERTTEMBERG], { country: NL, state: ZH })).toBeUndefined();
    expect(optionFor([BADEN_WUERTTEMBERG], undefined)).toBeUndefined();
  });

  it("keeps a stored region the source no longer lists, so the choice never reads as unset", () => {
    const list = [BADEN_WUERTTEMBERG];

    // A region the source still offers is the list itself — nothing to add.
    expect(optionsFor(list, { country: DE, state: BW })).toBe(list);
    expect(optionsFor(list, undefined)).toBe(list);

    // One it no longer offers is shown as its own ref, so the select displays what the model holds.
    const withStored = optionsFor(list, { country: NL, state: ZH });
    expect(withStored).toHaveLength(2);
    expect(withStored[1]).toEqual({ country: NL, state: ZH, label: `${NL}-${ZH}`, bounds: [0, 0, 0, 0] });
  });
});
