/**
 * The building's stored BuEM demand, which fills the configurator's energy
 * card when the building opens. Only a saved model has a demand-profile route:
 * a draft's results stay linked to the draft until it is saved, so a draft
 * shows none.
 */

import { useEffect, useRef, useState, type Dispatch, type SetStateAction } from 'react';

import { isAxiosError } from 'axios';
import type { BuildingDemandProfile } from '@thd-spatial-ai/building-configurator';

import axios from '@/lib/axios';

type Profile = BuildingDemandProfile | null | undefined;

/**
 * Undefined while loading and null when nothing is stored, as Building3DView
 * reads it. The setter takes a run's response, which is the building's new
 * stored summary, so the view follows a run without fetching again.
 */
export function useDemandProfile(modelId: number | undefined, osmId: string): [Profile, Dispatch<SetStateAction<Profile>>] {
  const [profile, setProfile] = useState<Profile>(undefined);

  // Guards a response that arrives after the user has moved to another building.
  const current = useRef('');

  useEffect(() => {
    const key = `${modelId}:${osmId}`;
    current.current = key;
    if (!modelId) {
      setProfile(null);
      return;
    }
    setProfile(undefined);
    axios
      .get<BuildingDemandProfile>(`/models/${modelId}/buildings/${encodeURIComponent(osmId)}/demand-profile`)
      .then((res) => {
        if (current.current === key) setProfile(res.data);
      })
      .catch((err) => {
        if (current.current !== key) return;
        // 404 is the backend's answer for a building with no stored series yet.
        if (!(isAxiosError(err) && err.response?.status === 404)) {
          console.error('[configurator] could not fetch the demand profile of building', osmId, 'in model', modelId, err);
        }
        setProfile(null);
      });
  }, [modelId, osmId]);

  return [profile, setProfile];
}
