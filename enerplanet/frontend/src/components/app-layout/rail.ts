// The rail widens from --sidebar-width to w-60 on hover (after a short delay),
// on keyboard focus of a page link (data-rail-expand), and while one of its menus
// is open (data-expanded). The menu triggers are left out: a closing menu hands
// focus back to its trigger, which Chrome then matches as :focus-visible.

/** Shown only while the rail is expanded. */
export const RAIL_SHOW =
  "opacity-0 transition-opacity duration-200 group-hover/rail:opacity-100 group-hover/rail:delay-150 group-has-[[data-rail-expand]:focus-visible]/rail:opacity-100 group-data-[expanded=true]/rail:opacity-100 motion-reduce:transition-none";

/** Shown only while the rail is collapsed. */
export const RAIL_HIDE =
  "opacity-100 transition-opacity duration-200 group-hover/rail:opacity-0 group-hover/rail:delay-150 group-has-[[data-rail-expand]:focus-visible]/rail:opacity-0 group-data-[expanded=true]/rail:opacity-0 motion-reduce:transition-none";

/** The name beside a rail icon. */
export const RAIL_LABEL = `min-w-0 truncate whitespace-nowrap text-sm font-medium ${RAIL_SHOW}`;

/** Declared only while the rail is expanded, and takes no width while collapsed. */
export const RAIL_SHOW_SHRINK = `${RAIL_SHOW} w-0 overflow-hidden group-hover/rail:w-11 group-data-[expanded=true]/rail:w-11 group-has-[[data-rail-expand]:focus-visible]/rail:w-11 motion-reduce:transition-none`;

/** The fixed 2.75rem slot that keeps each icon in place while the rail widens. */
export const RAIL_ICON_SLOT = "relative flex w-11 shrink-0 items-center justify-center";
