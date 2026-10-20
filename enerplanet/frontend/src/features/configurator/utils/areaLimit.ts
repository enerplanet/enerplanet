/** A custom grid's building cap; must match siteBuildingLimit in backend internal/handler/pylovo/site.go. */
export const SITE_BUILDING_LIMIT = 150;

/** The most buildings an area may hold: the user's limit (0 = none), and in a custom grid at most its cap. */
export const areaBuildingLimit = (userLimit: number, siteMode: boolean): number => {
  if (!siteMode) return userLimit;
  return userLimit > 0 ? Math.min(userLimit, SITE_BUILDING_LIMIT) : SITE_BUILDING_LIMIT;
};
