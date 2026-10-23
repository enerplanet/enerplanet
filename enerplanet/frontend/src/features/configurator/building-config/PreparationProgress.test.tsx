import { describe, it, expect, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { PreparationBar } from './PreparationProgress';

vi.mock('@spatialhub/i18n', () => ({ useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }) }));

const segments = (html: string) => html.match(/<span class="h-1\.5[^"]*"/g) ?? [];

describe('PreparationBar', () => {
  it('fills the stages done, pulses the current one and leaves the rest empty', () => {
    const html = renderToStaticMarkup(<PreparationBar stage={{ key: 'extract_features', label: 'Measuring', index: 2, count: 3 }} />);
    const parts = segments(html);
    expect(parts).toHaveLength(3);
    expect(parts[0]).toContain('bg-primary');
    expect(parts[0]).not.toContain('animate-pulse');
    expect(parts[1]).toContain('animate-pulse');
    expect(parts[2]).toContain('bg-muted');
    expect(html).toContain('Measuring');
  });

  it('fills nothing in the first stage', () => {
    const parts = segments(renderToStaticMarkup(<PreparationBar stage={{ key: 'import', label: 'Loading', index: 1, count: 3 }} />));
    expect(parts[0]).toContain('animate-pulse');
    expect(parts.slice(1).every((p) => p.includes('bg-muted'))).toBe(true);
  });
});
