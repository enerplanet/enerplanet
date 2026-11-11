import technologyService, { type Technology } from "@/features/technologies/services/technologyService";

export const ELECTRICITY_TYPES = ["pv_supply", "battery_storage"];
export const HEAT_SUPPLY_TYPES = ["air_source_heat_pump", "ground_source_heat_pump", "electric_boilers", "gas_boiler"];
export const HEAT_TYPES = [...HEAT_SUPPLY_TYPES, "air_conditioner"];

/** Fuel a technology type buys, for its price line. */
export const FUEL_BY_TYPE: Record<string, string[]> = { gas_boiler: ["natural_gas"] };

/** The technology type a product provides. */
export const productType = (product: Technology): string => product.type ?? product.key;

/** The type's default product: the one keyed by the type itself, else the first. */
export const defaultProduct = (products: Technology[], type: string): Technology | undefined =>
  products.find((p) => p.key === type) ?? products.find((p) => productType(p) === type);

/** The products of one type, the default first. */
export const productsOfType = (products: Technology[], type: string): Technology[] =>
  products.filter((p) => productType(p) === type).sort((a, b) => Number(b.key === type) - Number(a.key === type));

/** The products whose name or manufacturer contains query, in alphabetical order of name. */
export const findProducts = (products: Technology[], query: string): Technology[] => {
  const q = query.trim().toLowerCase();
  return products
    .filter((p) => !q || `${p.alias} ${p.manufacturer ?? ""}`.toLowerCase().includes(q))
    .sort((a, b) => a.alias.localeCompare(b.alias, undefined, { sensitivity: "base" }));
};

/** The product as a building stores it: keyed by its type, naming the product. */
export const asBuildingTechnology = (product: Technology): Technology => ({
  ...product,
  key: productType(product),
  product: product.key,
});

/** A product's constraints with their default values, as a building stores them. */
export const defaultConstraints = (product: Technology): { key: string; value: number | string }[] =>
  product.constraints.map((c) => ({ key: c.key, value: c.default_value }));

let pending: Promise<Technology[]> | null = null;

/**
 * The technology catalogue as it is now; the bundled defaults when the API fails.
 * Callers loading at the same time share one request, but no result is kept, so
 * a technology added or renamed since shows on the next load.
 */
export function loadCatalogue(): Promise<Technology[]> {
  pending ??= technologyService.getAll()
    .catch(async () => {
      const response = await fetch("/initial-data/techs/default_technologies.json");
      return response.ok ? ((await response.json()).technologies as Technology[]) : [];
    })
    .finally(() => { pending = null; });
  return pending;
}
