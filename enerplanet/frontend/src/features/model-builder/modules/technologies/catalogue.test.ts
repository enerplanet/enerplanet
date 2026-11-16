/**
 * `technologies`'s catalogue slot.
 *
 * The slot is what keeps this module free of the app's HTTP client, so these cases install a fake source the
 * way a host installs the real one — and never touch the network. Two things are worth pinning: that the list
 * comes *from* the source, and that a failed load is reported as a failure rather than an empty catalogue.
 *
 * (The catalogue's *arithmetic* — the vector map and the expected-fit table — has its own cases in
 * `index.test.ts`; this file is about the load.)
 */
import { describe, expect, it } from "vitest";
import { catalogueState, loadCatalogue, setCatalogueSource, type CatalogueProduct } from "./catalogue";

/** The port's fields, named once so the cases and the fixtures agree. */
const PV = "pv_supply";

const PRODUCTS: readonly CatalogueProduct[] = [{ key: PV, alias: "PV", type: PV }];

describe("technologies's catalogue slot", () => {
  it("offers the products the source answers with", async () => {
    setCatalogueSource({ load: () => Promise.resolve(PRODUCTS) });

    await loadCatalogue();

    expect(catalogueState()).toEqual({ products: PRODUCTS, loading: false, failed: false });
  });

  it("reports a failed load as a failure, not an empty catalogue", async () => {
    setCatalogueSource({ load: () => Promise.reject(new Error("backend down")) });

    await loadCatalogue();

    expect(catalogueState()).toEqual({ products: [], loading: false, failed: true });
  });

  it("asks as soon as a source is installed, rather than waiting for the panel to mount", async () => {
    // The shell installs its source from an effect, and React runs a child's effects before its parent's — so
    // the panel's mount-time load runs first, finds no source, and bails. If the install did not ask, nothing
    // ever would, and the picker would sit on "loading" forever with no request in flight.
    let asked = 0;
    setCatalogueSource({
      load: () => {
        asked += 1;
        return Promise.resolve(PRODUCTS);
      },
    });

    expect(asked).toBe(1);

    await Promise.resolve();
    await Promise.resolve();
    expect(catalogueState().products).toEqual(PRODUCTS);
  });

  it("asks the source once, so a panel that mounts later does not ask again", async () => {
    let calls = 0;
    setCatalogueSource({
      load: () => {
        calls += 1;
        return Promise.resolve(PRODUCTS);
      },
    });
    expect(calls).toBe(1); // the install asked

    // A (re)mount pulls again; the load is already owed and answered, so it must not ask a second time.
    await loadCatalogue();
    await loadCatalogue();

    expect(calls).toBe(1);
    expect(catalogueState().products).toEqual(PRODUCTS);
  });

  it("says nothing is loading when no source is installed", async () => {
    setCatalogueSource(null);

    await loadCatalogue();

    expect(catalogueState()).toEqual({ products: [], loading: false, failed: false });
  });
});
