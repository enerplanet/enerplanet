// Single source of truth for all technology cards in the Building Configurator.
//
// To hide a card:  set visible: false.
// To keep its params in the exported data model even when hidden: also set includeInModel: true.
// To add a new building-level technology: append an entry, implement the panel component,
// and add a matching case in BuildingConfigurator's renderCenterPanel.

import { Battery, Sun, Thermometer } from 'lucide-react';
import type React from 'react';

export type TechScope =
  /** Configured per building surface (no building-level install toggle). Solar PV. */
  | 'per-surface'
  /** Building-level toggle with a dedicated configure panel. Battery. */
  | 'building'
  /** Install toggle only — no configure panel. Heat pump, EV charger. */
  | 'none';

export interface TechCardDefinition {
  /** Stable identifier used in installedTechIds and the exported data model. */
  id: string;
  /** Display name shown on tech cards and in the configure-view nav. */
  label: string;
  /** Lucide icon component. */
  Icon: React.ElementType;
  /**
   * When false the card is hidden from Overview and Configure nav.
   * The technology is invisible to the user.
   */
  visible: boolean;
  /**
   * When true the tech's parameters are written to the exported data model even
   * when visible = false. Useful for techs the simulation engine always expects
   * regardless of whether they are surfaced in the UI.
   */
  includeInModel: boolean;
  /** Where the technology is configured. */
  scope: TechScope;
  /**
   * panelView value to navigate to when the tech is opened.
   * Required when scope is 'building' or 'per-surface'.
   */
  panelView?: string;
  /** Tailwind text-color class applied to the icon in the configure-view nav when not selected. */
  navIconColor?: string;
}

/** Runtime data passed per nav item from BuildingConfigurator to SurfaceGroupSelector. */
export interface TechNavItem {
  id: string;
  label: string;
  Icon: React.ElementType;
  /** Whether this tech's panel is currently open in the configure workspace. */
  selected: boolean;
  /** Short badge text shown next to the icon (e.g. surface count or installed dot). */
  badge?: string;
  /** One-line subtitle under the label. */
  subtitle: string;
  onSelect: () => void;
  /** Tailwind text-color class for the icon when not selected. */
  navIconColor?: string;
}

export const TECH_REGISTRY: TechCardDefinition[] = [
  {
    id:             'solar_pv',
    label:          'Solar PV',
    Icon:           Sun,
    visible:        true,
    includeInModel: false,
    scope:          'per-surface',
    panelView:      'technology-pv',
    navIconColor:   'text-yellow-500',
  },
  {
    id:             'battery',
    label:          'Battery',
    Icon:           Battery,
    visible:        true,
    includeInModel: false,
    scope:          'building',
    panelView:      'technology-battery',
    navIconColor:   'text-blue-500',
  },
  {
    id:             'heat_pump',
    label:          'Heat Pump',
    Icon:           Thermometer,
    visible:        false,
    includeInModel: false,
    scope:          'none',
  },
];

/** Registry entries shown to the user in Overview and Configure. */
export const VISIBLE_TECHS = TECH_REGISTRY.filter((t) => t.visible);
