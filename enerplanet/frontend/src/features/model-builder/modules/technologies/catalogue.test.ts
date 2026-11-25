/** `technologies`'s catalogue slot: the list comes from the source, and a failure is reported as one. */
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
    // Child effects run before the parent's, so the mount-time load must ask the shell to install the source.
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
