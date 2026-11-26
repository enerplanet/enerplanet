/**
 * The PV products a building's arrays use. The building keeps a copy of each,
 * as it does of its own product, so a later edit or deletion in the catalogue
 * leaves a saved model as it was.
 */

import { DEFAULT_PV_MODULE, type PvModule, type TechnologyProduct } from '@thd-spatial-ai/building-configurator';

/** A building's copy of a product: its name and its parameter values. */
export interface PvProductCopy {
  alias?: string;
  constraints: { key: string; value: unknown }[];
}

/** The product as a building keeps it, with each parameter at its default value. */
export const copyOfProduct = (product: TechnologyProduct): PvProductCopy => ({
  alias: product.alias,
  constraints: product.constraints.map((c) => ({ key: c.key, value: c.default_value })),
});

/**
 * The copy of every product the arrays name: the building's stored copy, else
 * one taken from the catalogue now. A product in neither is left out.
 */
export function productCopies(
  arrays: readonly { product_id?: string }[],
  stored: Record<string, PvProductCopy> | undefined,
  catalogue: readonly TechnologyProduct[] | undefined,
): Record<string, PvProductCopy> {
  const copies: Record<string, PvProductCopy> = {};
  for (const { product_id: id } of arrays) {
    if (!id || copies[id]) continue;
    const product = catalogue?.find((p) => p.id === id);
    const copy = stored?.[id] ?? (product && copyOfProduct(product));
    if (copy) copies[id] = copy;
  }
  return copies;
}

/** A parameter's value as a number, or undefined when it is missing or not a number. */
function numberOf(constraints: readonly { key: string; value: unknown }[], key: string): number | undefined {
  const value = Number(constraints.find((c) => c.key === key)?.value);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * The module of a product's parameters, from module_width_m, module_height_m
 * and module_power_kwp as the building configurator reads them; the default
 * module without all three.
 */
export function moduleOf(constraints: readonly { key: string; value: unknown }[] | undefined): PvModule {
  if (!constraints) return DEFAULT_PV_MODULE;
  const width = numberOf(constraints, 'module_width_m');
  const height = numberOf(constraints, 'module_height_m');
  const kwp = numberOf(constraints, 'module_power_kwp');
  return width && height && kwp ? { width, height, kwp } : DEFAULT_PV_MODULE;
}

type Values = PvProductCopy['constraints'];

/** The building's own PV values and its copies of the products its arrays name. */
export interface PvValues {
  /** The values of the building's product, used by the arrays that name no product. */
  constraints?: Values;
  copies?: Record<string, PvProductCopy>;
}

/** values with key set to value, added when absent. */
function setValue(values: Values, key: string, value: unknown): Values {
  return values.some((c) => c.key === key)
    ? values.map((c) => (c.key === key ? { ...c, value } : c))
    : [...values, { key, value }];
}

/**
 * values with one parameter of product id set: the building's own values when
 * id is the building's product, else that product's copy, taken from the
 * catalogue on its first edit. A stored copy of the building's product is kept
 * in step. A product neither stored nor in the catalogue leaves values as they are.
 */
export function withProductValue(
  values: PvValues,
  id: string,
  key: string,
  value: number | string,
  buildingProductId: string | undefined,
  catalogue: readonly TechnologyProduct[] | undefined,
): PvValues {
  const product = catalogue?.find((p) => p.id === id);
  const own = id === buildingProductId;
  const copy = values.copies?.[id] ?? (own ? undefined : product && copyOfProduct(product));
  if (!own && !copy) return values;
  return {
    constraints: own ? setValue(values.constraints ?? (product ? copyOfProduct(product).constraints : []), key, value) : values.constraints,
    copies: copy ? { ...values.copies, [id]: { ...copy, constraints: setValue(copy.constraints, key, value) } } : values.copies,
  };
}

/** The product with each parameter at its stored value where values has a number or text for it. */
export function withValues(product: TechnologyProduct, values: Values): TechnologyProduct {
  const stored = new Map(values.map((c) => [c.key, c.value]));
  return {
    ...product,
    constraints: product.constraints.map((c) => {
      const value = stored.get(c.key);
      return typeof value === 'number' || typeof value === 'string' ? { ...c, default_value: value } : c;
    }),
  };
}
