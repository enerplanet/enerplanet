import { describe, it, expect } from 'vitest';
import { anchoredPlacement } from './InfoTooltip';

const viewport = { width: 1500, height: 800 };
const icon = (top: number) => ({ top, left: 1200, right: 1216, height: 16 });

describe('anchoredPlacement', () => {
  it('centres the card on the icon when it fits', () => {
    expect(anchoredPlacement(icon(392), { width: 320, height: 200 }, viewport, 'left')).toEqual({ top: 400, left: 1190 });
  });

  it('moves a tall card up so its bottom stays inside the viewport', () => {
    const { top } = anchoredPlacement(icon(700), { width: 320, height: 600 }, viewport, 'left');
    expect(top + 300).toBeLessThanOrEqual(viewport.height - 8);
    expect(top - 300).toBeGreaterThanOrEqual(8);
  });

  it('pins a card taller than the viewport to the viewport, where it scrolls', () => {
    expect(anchoredPlacement(icon(700), { width: 320, height: 2000 }, viewport, 'left').top).toBe(400);
  });

  it('keeps a card that opens to the left off the left edge', () => {
    expect(anchoredPlacement({ top: 392, left: 100, right: 116, height: 16 }, { width: 320, height: 200 }, viewport, 'left').left).toBe(328);
  });

  it('keeps a card that opens to the right off the right edge', () => {
    expect(anchoredPlacement({ top: 392, left: 1400, right: 1416, height: 16 }, { width: 320, height: 200 }, viewport, 'right').left).toBe(1172);
  });
});
