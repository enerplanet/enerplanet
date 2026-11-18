/**
 * A building's installed technologies for the 3D view: the Technologies tab's
 * cards. Edits go to the host, which stores them on the building.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Technologies } from '@thd-spatial-ai/building-configurator';
import { useTranslation } from '@spatialhub/i18n';

import { useModelStore } from '@/features/configurator/store/modelStore';
import { loadCatalogue } from '@/features/technologies/catalogue';
import type { Technology } from '@/features/technologies/services/technologyService';
import {
  errorKey, productOf, productOptions, removeTech, setTechField, setTechProduct, technologiesProp, technologyCards,
  type BuildingTechs, type FieldErrors,
} from './buildingTechnologies';

/** The technology catalogue, loaded once per view; empty until loaded. */
function useCatalogue(): Technology[] {
  const [catalogue, setCatalogue] = useState<Technology[]>([]);
  useEffect(() => {
    let cancelled = false;
    loadCatalogue().then((all) => { if (!cancelled) setCatalogue(all); });
    return () => { cancelled = true; };
  }, []);
  return catalogue;
}

/**
 * initial is the building's techs when the view opens; onChange receives every
 * edit as the building's full techs. onAdd opens the host's technology list.
 * technologies is undefined while the building has none and there is no onAdd,
 * so the view shows no empty tab.
 */
export function useBuildingTechnologies(
  initial: BuildingTechs | null,
  onChange?: (techs: BuildingTechs) => void,
  onAdd?: () => void,
): { technologies: Technologies | undefined } {
  const { t } = useTranslation();
  const runMode = useModelStore((s) => s.runMode);
  const [techs, setTechs] = useState<BuildingTechs>(initial ?? {});
  const [errors, setErrors] = useState<FieldErrors>({});
  const catalogue = useCatalogue();
  const catalogueRef = useRef(catalogue);
  catalogueRef.current = catalogue;
  // A link can open the view before the map has loaded the building; follow its techs once they arrive.
  useEffect(() => { if (initial) setTechs(initial); }, [initial]);
  // The callbacks read the latest techs without changing identity, as the view asks.
  const techsRef = useRef(techs);
  techsRef.current = techs;

  const store = useCallback((next: BuildingTechs) => {
    setTechs(next);
    onChange?.(next);
  }, [onChange]);

  const onFieldChange = useCallback((id: string, fieldKey: string, value: number | null) => {
    const result = setTechField(techsRef.current, id, fieldKey, value, t, catalogueRef.current);
    const key = errorKey(id, fieldKey);
    if ('error' in result) {
      setErrors((prev) => ({ ...prev, [key]: result.error }));
      return;
    }
    setErrors((prev) => {
      const { [key]: _cleared, ...rest } = prev;
      return rest;
    });
    store(result.techs);
  }, [store, t]);

  const onRemove = useCallback((id: string) => store(removeTech(techsRef.current, id)), [store]);

  // A product switch replaces every value, so the errors of the old ones go.
  const onSelectProduct = useCallback((id: string, productId: string) => {
    const product = catalogueRef.current.find((p) => p.key === productId);
    if (!product) return;
    setErrors((prev) => Object.fromEntries(Object.entries(prev).filter(([key]) => !key.startsWith(`${id}:`))));
    store(setTechProduct(techsRef.current, id, product));
  }, [store]);

  const technologies = useMemo(() => {
    const cards = technologyCards(techs, runMode, errors, t, catalogue).map((card) => {
      const products = productOptions(catalogue, card.id);
      if (products.length === 0) return card;
      const productId = productOf(catalogue, card.id, techs[card.id])?.key;
      return { ...card, catalogue: { products, productId, onSelect: (productId: string) => onSelectProduct(card.id, productId) } };
    });
    return technologiesProp(cards, onFieldChange, onRemove, onAdd);
  }, [techs, runMode, errors, t, catalogue, onFieldChange, onRemove, onAdd, onSelectProduct]);

  return { technologies };
}
