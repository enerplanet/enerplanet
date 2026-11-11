import { useMemo } from 'react';
import { resultFill, resultText } from '@/constants/tech-colors';
import { useIsDarkMode } from '@/features/simulation-charts/pypsa/chartUtils';

/** Something drawn in a results chart: its flow key and the colour to use when the palette has none. */
type Item = { key: string; color: string };

/** Dark text on light fills, white on dark ones; used when the palette has no text colour. */
const textOn = (hex: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '#111827' : '#ffffff';
};

/** Results palette colours for the current theme. */
export function useResultColors() {
  const dark = useIsDarkMode();
  return useMemo(() => {
    const fill = (item: Item, carrier?: string) => resultFill(item.key, dark, carrier) ?? item.color;
    const text = (item: Item, carrier?: string) => resultText(item.key, dark, carrier) ?? textOn(fill(item, carrier));
    return { dark, fill, text };
  }, [dark]);
}
