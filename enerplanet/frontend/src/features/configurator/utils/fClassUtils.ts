const DELIMITERS = /[,;|/]+/;

const NON_INFORMATIVE = new Set([
  '',
  'yes',
  'building',
  'unknown',
  'none',
  'null',
  'n_a',
  'na',
]);

const ALIASES: Record<string, string> = {
  'semi_detached': 'semidetached_house',
  'semi-detached': 'semidetached_house',
  'town_house': 'townhouse',
  'community_center': 'community_centre',
  'doctor': 'doctors',
};

const GENERIC_PRIMARY_CLASSES = new Set([
  'yes',
  'building',
  'residential',
  'house',
  'apartments',
  'apartment',
  'detached',
  'semidetached_house',
  'terrace',
  'townhouse',
  'allotment_house',
  'unclassified',
  'other',
]);

export const normalizeFClass = (value: string): string => {
  let normalized = value.trim().toLowerCase();
  if (!normalized) return '';

  normalized = normalized
    .replace(/[-\s]+/g, '_')
    .replace(/__+/g, '_')
    .replace(/^_+|_+$/g, '');

  if (!normalized || NON_INFORMATIVE.has(normalized)) return '';
  return ALIASES[normalized] || normalized;
};

const dedupe = (items: string[]): string[] => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of items) {
    if (!item || seen.has(item)) continue;
    seen.add(item);
    out.push(item);
  }
  return out;
};

const parseStringFClasses = (raw: string): string[] => {
  const value = raw.trim();
  if (!value) return [];

  if (value.startsWith('[') && value.endsWith(']')) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        return parseFClassValue(parsed);
      }
    } catch {
      // Continue with delimiter parsing.
    }
  }

  const parts = value.split(DELIMITERS).map((part) => part.trim());
  const expanded = parts.length > 1 ? parts : [value];

  return dedupe(
    expanded
      .map((part) => part.replace(/^["'[]+|["'\]]+$/g, ''))
      .map(normalizeFClass)
      .filter(Boolean)
  );
};

export const parseFClassValue = (value: unknown): string[] => {
  if (value == null) return [];

  if (Array.isArray(value)) {
    return dedupe(value.flatMap((item) => parseFClassValue(item)));
  }

  if (typeof value === 'string') {
    return parseStringFClasses(value);
  }

  return [];
};

export const getFeatureFClasses = (
  props: Record<string, unknown> | null | undefined
): string[] => {
  if (!props) return [];

  const canonicalKeys = ['f_classes', 'f_class', 'fclass'];
  const canonicalClasses = dedupe(canonicalKeys.flatMap((key) => parseFClassValue(props[key])));
  if (canonicalClasses.length > 0) {
    return canonicalClasses;
  }

  const fallbackKeys = ['type', 'use', 'building_type', 'building_t'];
  return dedupe(fallbackKeys.flatMap((key) => parseFClassValue(props[key])));
};

const classSpecificityScore = (value: string): number => {
  const fc = normalizeFClass(value);
  if (!fc) return -1;
  if (GENERIC_PRIMARY_CLASSES.has(fc)) return 0;
  return 1;
};

export const getPrimaryFClassFromClasses = (classes: string[]): string | undefined => {
  if (!classes.length) return undefined;

  let best = classes[0];
  let bestScore = classSpecificityScore(classes[0]);

  for (let i = 1; i < classes.length; i += 1) {
    const current = classes[i];
    const score = classSpecificityScore(current);
    if (score > bestScore) {
      best = current;
      bestScore = score;
    }
  }

  return best;
};

export const getPrimaryFClass = (
  props: Record<string, unknown> | null | undefined
): string | undefined => {
  const classes = getFeatureFClasses(props);
  return getPrimaryFClassFromClasses(classes);
};

export const formatFClassLabel = (value: string): string => {
  const normalized = normalizeFClass(value) || value.trim();
  if (!normalized) return '';
  return normalized
    .split('_')
    .map((token) => {
      if (!token) return '';
      if (token.length <= 3) return token.toUpperCase();
      return token.charAt(0).toUpperCase() + token.slice(1);
    })
    .join(' ');
};

const RESIDENTIAL_F_CLASSES = new Set([
  'residential',
  'house',
  'detached',
  'semidetached_house',
  'terrace',
  'townhouse',
  'apartment',
  'apartments',
  'allotment_house',
  'houseboat',
  'bungalow',
  'villa',
  'dormitory',
  'static_caravan',
  'summer_house',
  'cabin',
  'hut',
  'ger',
  'trullo',
  'sfh',
  'mfh',
  'th',
]);

export const isResidentialFClass = (value: string): boolean => {
  const normalized = normalizeFClass(value);
  if (!normalized) return false;
  if (RESIDENTIAL_F_CLASSES.has(normalized)) return true;
  return normalized.startsWith('residential_') || normalized.startsWith('apartment_');
};

/**
 * All known f_class values from Pylovo consumer_categories config.
 * Sorted alphabetically; residential types listed first, then non-residential.
 */
export const ALL_F_CLASSES: readonly string[] = [
  // ── Residential ──
  'apartments',
  'bungalow',
  'cabin',
  'detached',
  'dormitory',
  'farmhouse',
  'ger',
  'house',
  'houseboat',
  'hut',
  'residential',
  'semidetached_house',
  'static_caravan',
  'summer_house',
  'terrace',
  'townhouse',
  'tree_house',
  'trullo',
  'villa',
  // ── Commercial / Retail ──
  'bakery',
  'bank',
  'bar',
  'beverages',
  'bicycle',
  'books',
  'butcher',
  'cafe',
  'car',
  'car_repair',
  'car_wash',
  'chemist',
  'clothes',
  'commercial',
  'company',
  'convenience',
  'doityourself',
  'electronics',
  'fast_food',
  'florist',
  'fuel',
  'furniture',
  'garden_centre',
  'hairdresser',
  'hardware',
  'insurance',
  'jewelry',
  'kiosk',
  'mall',
  'marketplace',
  'motel',
  'nightclub',
  'optician',
  'pet',
  'pharmacy',
  'pub',
  'restaurant',
  'retail',
  'shoes',
  'shop',
  'store',
  'supermarket',
  'toys',
  'travel_agency',
  'wholesale',
  // ── Hospitality / Lodging ──
  'guest_house',
  'hostel',
  'hotel',
  // ── Office / Institutional ──
  'civic',
  'college',
  'courthouse',
  'data_center',
  'diplomatic',
  'educational_institution',
  'embassy',
  'government',
  'kindergarten',
  'library',
  'military',
  'museum',
  'nursing_home',
  'office',
  'police',
  'post_office',
  'prison',
  'research',
  'retirement_home',
  'school',
  'social_facility',
  'station',
  'townhall',
  'train_station',
  'university',
  // ── Healthcare ──
  'clinic',
  'dentist',
  'doctors',
  'healthcare',
  'hospital',
  'veterinary',
  // ── Religious ──
  'cathedral',
  'chapel',
  'church',
  'monastery',
  'mosque',
  'place_of_worship',
  'religious',
  'shrine',
  'synagogue',
  'temple',
  // ── Industrial / Agricultural ──
  'agricultural',
  'barn',
  'brewery',
  'cowshed',
  'digester',
  'factory',
  'farm',
  'farm_auxiliary',
  'granary',
  'greenhouse',
  'hayloft',
  'industrial',
  'livestock',
  'logistics',
  'manufacture',
  'metal_construction',
  'oil_mill',
  'sawmill',
  'silo',
  'slurry_tank',
  'stable',
  'storage_tank',
  'sty',
  'warehouse',
  'watermill',
  'windmill',
  'winery',
  'works',
  'workshop',
  // ── Sports / Leisure ──
  'arts_centre',
  'cinema',
  'dance',
  'fitness_centre',
  'gallery',
  'grandstand',
  'pavilion',
  'riding_hall',
  'sauna',
  'sports',
  'sports_centre',
  'sports_hall',
  'stadium',
  'swimming_pool',
  'theatre',
  // ── Infrastructure / Utility ──
  'bicycle_parking',
  'bridge',
  'bunker',
  'carport',
  'container',
  'electricity',
  'fire_station',
  'garage',
  'garages',
  'gatehouse',
  'hangar',
  'parking',
  'power',
  'public',
  'public_bath',
  'roof',
  'service',
  'shed',
  'shelter',
  'substation',
  'tank',
  'tech_cab',
  'terminal',
  'toilets',
  'toll_booth',
  'transformer_tower',
  'transportation',
  'utility',
  'water_tower',
  // ── Trades / Services ──
  'association',
  'bakehouse',
  'carpenter',
  'electrician',
  'gardener',
  'painter',
  'plumber',
  'stonemason',
  'studio',
  'training',
  // ── Other / Misc ──
  'boat_house',
  'boathouse',
  'chicken_coop',
  'collapsed',
  'construction',
  'crematorium',
  'mixed_use',
  'other',
  'outbuilding',
  'ruins',
  'unclassified',
] as const;
