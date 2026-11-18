/**
 * `weather`'s archive slot.
 *
 * The slot is what keeps this module free of the app's HTTP client, so these cases install a fake source the
 * way a host installs the real one — and never touch the network. Two things are worth pinning: that the list
 * comes *from* the source, and that a failed load is reported as a failure rather than an empty list.
 */
import { describe, expect, it } from "vitest";
import { archivesState, loadArchives, setWeatherSource, type WeatherArchives } from "./archives";

/** The port's fields, named once so the cases and the fixtures agree. */
const ERA5 = "era5-land";

const ARCHIVES: WeatherArchives = { defaultProvider: ERA5, archives: { [ERA5]: [2020, 2021] } };

const NO_ARCHIVES: WeatherArchives = { defaultProvider: null, archives: {} };

describe("weather's archive slot", () => {
  it("offers the archives the source answers with", async () => {
    setWeatherSource({ listArchives: () => Promise.resolve(ARCHIVES) });

    await loadArchives();

    expect(archivesState()).toEqual({ archives: ARCHIVES, loading: false, failed: false });
  });

  it("reports a failed load as a failure, not an empty list", async () => {
    setWeatherSource({ listArchives: () => Promise.reject(new Error("backend down")) });

    await loadArchives();

    expect(archivesState()).toEqual({ archives: NO_ARCHIVES, loading: false, failed: true });
  });

  it("asks as soon as a source is installed, rather than waiting for the panel to mount", async () => {
    // The shell installs its source from an effect, and React runs a child's effects before its parent's — so
    // the panel's mount-time load runs first, finds no source, and bails. If the install did not ask, nothing
    // ever would, and the picker would sit on "loading" forever with no request in flight.
    let asked = 0;
    setWeatherSource({
      listArchives: () => {
        asked += 1;
        return Promise.resolve(ARCHIVES);
      },
    });

    expect(asked).toBe(1);

    await Promise.resolve();
    await Promise.resolve();
    expect(archivesState().archives).toEqual(ARCHIVES);
  });

  it("asks the source once, so a panel that mounts later does not ask again", async () => {
    let calls = 0;
    setWeatherSource({
      listArchives: () => {
        calls += 1;
        return Promise.resolve(ARCHIVES);
      },
    });
    expect(calls).toBe(1); // the install asked

    // A (re)mount pulls again; the load is already owed and answered, so it must not ask a second time.
    await loadArchives();
    await loadArchives();

    expect(calls).toBe(1);
    expect(archivesState().archives).toEqual(ARCHIVES);
  });

  it("says nothing is loading when no source is installed", async () => {
    setWeatherSource(null);

    await loadArchives();

    expect(archivesState()).toEqual({ archives: NO_ARCHIVES, loading: false, failed: false });
  });
});
