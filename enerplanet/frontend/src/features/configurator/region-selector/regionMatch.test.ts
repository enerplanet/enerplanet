import { describe, expect, it } from 'vitest';
import { regionMatch } from './regionMatch';

const bayern = { name: 'Bayern', postcodes: ['94447', '94469'] };
const gelderland = { name: 'Gelderland', postcodes: ['7371 AB', '7372'] };

describe('regionMatch', () => {
    it('lists every region for an empty or blank query', () => {
        expect(regionMatch(bayern, 'Germany', '')).toEqual({ matches: true });
        expect(regionMatch(bayern, 'Germany', '   ')).toEqual({ matches: true });
    });

    it('matches a region or country name anywhere, ignoring case and outer spaces', () => {
        expect(regionMatch(bayern, 'Germany', ' ayer ')).toEqual({ matches: true });
        expect(regionMatch(bayern, 'Germany', 'germ')).toEqual({ matches: true });
    });

    it('matches a postcode by its start and names the postcode', () => {
        expect(regionMatch(bayern, 'Germany', '9446')).toEqual({ matches: true, postcode: '94469' });
        expect(regionMatch(bayern, 'Germany', '94447')).toEqual({ matches: true, postcode: '94447' });
    });

    it('does not match a postcode by its middle', () => {
        expect(regionMatch(bayern, 'Germany', '4469')).toEqual({ matches: false });
    });

    it('matches postcodes written with or without spaces', () => {
        expect(regionMatch(gelderland, 'Netherlands', '7371ab')).toEqual({ matches: true, postcode: '7371 AB' });
        expect(regionMatch(gelderland, 'Netherlands', '7371 a')).toEqual({ matches: true, postcode: '7371 AB' });
    });

    it('does not match a region without postcodes on a number', () => {
        expect(regionMatch({ name: 'Bremen' }, 'Germany', '28')).toEqual({ matches: false });
    });
});
