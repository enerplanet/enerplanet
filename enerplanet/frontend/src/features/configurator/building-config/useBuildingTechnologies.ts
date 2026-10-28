/**
 * A building's installed technologies for the 3D view: the Technologies tab's
 * cards. Edits go to the host, which stores them on the building.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Technologies } from '@thd-spatial-ai/building-configurator';
import { useTranslation } from '@spatialhub/i18n';

import { useModelStore } from '@/features/configurator/store/modelStore';
import {
  errorKey, removeTech, setTechField, technologyCards,
  type BuildingTechs, type FieldErrors,
} from './buildingTechnologies';

/**
 * initial is the building's techs when the view opens; onChange receives every
 * edit as the building's full techs. technologies is undefined while the
 * building has none, so the view shows no empty tab.
 */
export function useBuildingTechnologies(
  initial: BuildingTechs | null,
  onChange?: (techs: BuildingTechs) => void,
): { technologies: Technologies | undefined } {
  const { t } = useTranslation();
  const runMode = useModelStore((s) => s.runMode);
  const [techs, setTechs] = useState<BuildingTechs>(initial ?? {});
  const [errors, setErrors] = useState<FieldErrors>({});
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
    const result = setTechField(techsRef.current, id, fieldKey, value, t);
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

  const technologies = useMemo<Technologies | undefined>(() => {
    const items = technologyCards(techs, runMode, errors, t);
    if (items.length === 0) return undefined;
    return { items, onChange: onFieldChange, onRemove };
  }, [techs, runMode, errors, t, onFieldChange, onRemove]);

  return { technologies };
}
