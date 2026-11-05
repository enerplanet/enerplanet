import { useEffect, useState } from 'react';
import { fetchCarrierTimeSeries } from '../api';
import { systemFlows, type CarrierResult } from '../buildingFlows';

/** Hourly model-wide flows for each carrier of the run; carriers without flows are left out. */
export function useSystemFlows(modelId: number | null, carriers: string[]) {
  const [results, setResults] = useState<CarrierResult[]>([]);
  const [loading, setLoading] = useState(false);
  const key = carriers.join(',');

  useEffect(() => {
    if (!modelId) return;
    const controller = new AbortController();
    const list = key.split(',').map((c) => c || 'power');
    setLoading(true);
    Promise.all(list.map((carrier) => fetchCarrierTimeSeries(modelId, { aggregate: 'hourly', carrier, signal: controller.signal })))
      .then((data) => {
        if (controller.signal.aborted) return;
        setResults(list.flatMap((carrier, i) => {
          const flows = systemFlows(data[i]?.carrier_prod ?? [], data[i]?.carrier_con ?? [], carrier);
          return flows.flows.length > 0 ? [{ carrier, ...flows }] : [];
        }));
        setLoading(false);
      });
    return () => controller.abort();
  }, [modelId, key]);

  return { results, loading };
}
