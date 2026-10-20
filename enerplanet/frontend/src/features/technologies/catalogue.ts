import technologyService, { type Technology } from "@/features/technologies/services/technologyService";

export const ELECTRICITY_TYPES = ["pv_supply", "battery_storage"];
export const HEAT_SUPPLY_TYPES = ["air_source_heat_pump", "ground_source_heat_pump", "electric_boilers", "gas_boiler"];
export const HEAT_TYPES = [...HEAT_SUPPLY_TYPES, "air_conditioner"];

/** The technology types a user can add a product for. */
export const PRODUCT_TYPES = [...ELECTRICITY_TYPES, ...HEAT_TYPES];

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

/** The product as a building stores it: keyed by its type, naming the product. */
export const asBuildingTechnology = (product: Technology): Technology => ({
  ...product,
  key: productType(product),
  product: product.key,
});

/**
 * A key for a new product of a type: the type and its name, with a random
 * suffix because keys are unique across all users' private products.
 */
export const newProductKey = (type: string, name: string, suffix = Math.random().toString(36).slice(2, 8)): string => {
  const slug = name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return [type, slug, suffix].filter(Boolean).join("_");
};

/** A product's constraints with their default values, as a building stores them. */
export const defaultConstraints = (product: Technology): { key: string; value: number | string }[] =>
  product.constraints.map((c) => ({ key: c.key, value: c.default_value }));

let catalogue: Promise<Technology[]> | null = null;

/** The technology catalogue, fetched once; the bundled defaults when the API fails. */
export function loadCatalogue(): Promise<Technology[]> {
  catalogue ??= technologyService.getAll().catch(async () => {
    catalogue = null;
    const response = await fetch("/initial-data/techs/default_technologies.json");
    return response.ok ? ((await response.json()).technologies as Technology[]) : [];
  });
  return catalogue;
}
