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
