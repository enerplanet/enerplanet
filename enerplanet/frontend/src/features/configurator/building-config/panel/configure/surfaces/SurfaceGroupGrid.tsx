/** @jsxImportSource react */
// Surface group view for the element configurator modal: a scrollable sidebar
// listing every surface in the group, and the selected one's editor filling the
// center — so switching surfaces never requires scrolling past the editor itself.

import React, { useState } from 'react';
import { Sun, Trash2, ChevronDown, Plus, Home, Layers, AlertTriangle } from 'lucide-react';
import { cn } from '@spatialhub/ui';
import { ELEMENT_DOTS, ScrollHintContainer } from '@/features/configurator/building-config/panel/shared/ui';
import type { BuildingElement } from '@/features/configurator/building-config/panel/configure/model/buildingElements';
import { faceFromAzimuth, isUserDefinedElement, hasInvalidArea } from '@/features/configurator/building-config/panel/configure/model/buildingElements';
import {
  ELEMENT_GROUP_LABELS,
  type ElementGroupKey,
} from '@/features/configurator/building-config/panel/shared/elementListUtils';
import type { PvConfig } from '@/features/configurator/building-config/panel/shared/buildingDefaults';
import {
  RoofTypeCards,
  detectRoofType,
} from '@/features/configurator/building-config/panel/configure/roof/RoofTypeGallery';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Short compass label for a surface's facing direction. */
function directionLabel(el: BuildingElement): string {
  if (el.type === 'floor') return 'Base';
  if (el.type === 'roof' && el.tilt <= 10) return 'Top';
  const MAP: Record<string, string> = {
    north_wall: 'N',  northeast_wall: 'NE',
    east_wall:  'E',  southeast_wall: 'SE',
    south_wall: 'S',  southwest_wall: 'SW',
    west_wall:  'W',  northwest_wall: 'NW',
  };
  return MAP[faceFromAzimuth(el.azimuth)] ?? '—';
}

const TYPE_ORDER: ElementGroupKey[] = ['wall', 'roof', 'floor', 'window', 'door'];

// ─── Component ────────────────────────────────────────────────────────────────

interface SurfaceGroupGridProps {
  groupType: ElementGroupKey;
  elements: Record<string, BuildingElement>;
  selectedElementId: string | null;
  onSelect: (id: string) => void;
  onDeleteSurface: (id: string) => void;
  /** Required for the Roof group — regenerates roof elements on type change. */
  onApplyRoofType?: (newRoofElements: Record<string, BuildingElement>) => void;
  /** Adds a new surface of this group's type. */
  onCreateSurface: (type: BuildingElement['type']) => void;
  /** Per-surface PV configurations — used to show a PV badge on cards. */
  surfacePvConfigs?: Record<string, PvConfig>;
  /** Editor for the currently selected surface, rendered in the center panel. */
  editorSlot?: React.ReactNode;
}

/** Sidebar surface list + center editor for a single element group. Roof also
 *  gets an inline expandable roof-type picker above the split. */
export function SurfaceGroupGrid({
  groupType,
  elements,
  selectedElementId,
  onSelect,
  onDeleteSurface,
  onApplyRoofType,
  onCreateSurface,
  surfacePvConfigs = {},
  editorSlot,
}: SurfaceGroupGridProps) {
  const [roofGalleryOpen, setRoofGalleryOpen] = useState(false);

  const items = TYPE_ORDER
    .flatMap((t) => (t === groupType ? Object.values(elements).filter((el) => el.type === t) : []))
    .sort((a, b) => a.azimuth - b.azimuth);

  const totalArea = items.reduce((s, el) => s + el.area, 0);
  const avgUValue = totalArea > 0
    ? items.reduce((s, el) => s + el.uValue * el.area, 0) / totalArea
    : 0;

  const dotColor = ELEMENT_DOTS[groupType];

  // Detect current roof type label for display
  const roofElements    = groupType === 'roof' ? items : [];
  const currentRoofType = groupType === 'roof' ? detectRoofType(roofElements) : null;
  const roofTypeLabel   = currentRoofType
    ? currentRoofType.charAt(0).toUpperCase() + currentRoofType.slice(1)
    : null;

  const renderSidebarCard = (el: BuildingElement) => {
    const selected    = el.id === selectedElementId;
    const dir         = directionLabel(el);
    const userDefined = isUserDefinedElement(el);
    const hasPv       = surfacePvConfigs[el.id]?.installed ?? false;
    const invalid     = hasInvalidArea(el);

    return (
      <div key={el.id} className="group relative">
        <button
          type="button"
          onClick={() => { setRoofGalleryOpen(false); onSelect(el.id); }}
          title={invalid ? 'Area must be greater than 0 to run a simulation' : undefined}
          className={cn(
            // Same shadow recipe as the Technologies cards in the main view,
            // so surface cards read as the same kind of clickable tile.
            'w-full rounded-lg border p-2.5 text-left transition-all cursor-pointer',
            invalid
              ? 'border-destructive/50 bg-destructive/5'
              : selected
              ? 'border-primary/40 bg-primary/8 shadow-[0_1px_3px_rgba(47,93,138,0.10),0_4px_12px_rgba(47,93,138,0.12)]'
              : 'border-slate-200/60 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.06),0_4px_12px_rgba(15,23,42,0.07)] hover:border-slate-300',
          )}
        >
          {/* pr-5 keeps the direction badge clear of the delete button, which
              is absolutely positioned in the same top-right corner and only
              appears on hover. */}
          <div className="flex items-center justify-between gap-1.5 pr-5">
            <span className={cn('min-w-0 flex-1 truncate text-[11px] font-semibold leading-tight', invalid ? 'text-destructive' : selected ? 'text-primary' : 'text-slate-700')}>
              {el.label}
            </span>
            <span className={cn('shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold', selected ? 'bg-primary/15 text-primary' : 'bg-slate-100 text-slate-500')}>
              {dir}
            </span>
          </div>
          <div className="mt-1.5 flex items-center gap-2">
            {invalid && <AlertTriangle className="size-3 shrink-0 text-destructive" />}
            <span className={cn('text-[10px] font-medium', invalid ? 'text-destructive' : selected ? 'text-primary/80' : 'text-slate-500')}>
              {el.area.toFixed(1)} m²
            </span>
            <span className={cn('text-[10px] font-medium', selected ? 'text-primary/80' : 'text-slate-500')}>
              U {el.uValue.toFixed(2)}
            </span>
            {userDefined && (
              <span className="rounded border border-blue-200 bg-blue-50 px-1 py-0.5 text-[8px] font-semibold text-blue-700">User</span>
            )}
            {hasPv && (
              <span title="PV installed" className="inline-flex">
                <Sun className="size-3 shrink-0 text-yellow-500" />
              </span>
            )}
          </div>
        </button>

        <button
          type="button"
          title="Delete surface"
          onClick={() => onDeleteSurface(el.id)}
          className="invisible absolute right-1.5 top-1.5 flex size-5 cursor-pointer items-center justify-center rounded bg-white/80 text-slate-400 shadow-sm transition-colors hover:bg-red-50 hover:text-red-500 group-hover:visible [&_svg]:size-3"
        >
          <Trash2 />
        </button>
      </div>
    );
  };

  return (
    <div className="flex h-full min-h-0 flex-col">

      {/* ── Header — everything grouped on the left; pr-12 keeps the right
          side clear of the modal's close button instead of anything sitting
          next to it. ── */}
      <div className="flex shrink-0 items-center gap-2 border-b border-slate-200 bg-white px-5 py-4 pr-12">
        <span className="size-2.5 shrink-0 rounded-full" style={{ backgroundColor: dotColor }} />
        <h2 className="text-sm font-semibold text-slate-700">
          {ELEMENT_GROUP_LABELS[groupType]}
        </h2>
        {roofTypeLabel && (
          <span className="rounded-md border border-slate-200 bg-white px-2 py-0.5 text-[10px] font-semibold text-slate-500">
            {roofTypeLabel}
          </span>
        )}
        <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-500">
          {items.length}
        </span>
        <span className="text-slate-300">|</span>
        <span className="text-[11px] text-slate-400">{totalArea.toFixed(1)} m² total</span>
        <span className="text-slate-300">|</span>
        <span className="text-[11px] text-slate-400">avg U {avgUValue.toFixed(2)} W/m²K</span>
      </div>

      {/* ── Roof type section — expandable, Roof group only ── */}
      {groupType === 'roof' && onApplyRoofType && (
        <div className="shrink-0 overflow-hidden border-b border-primary/15 bg-primary/5">
          <button
            type="button"
            onClick={() => setRoofGalleryOpen((v) => !v)}
            className="flex w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-primary/8 cursor-pointer"
          >
            <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/15">
              <Home className="size-4 text-primary" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-bold text-slate-800">Roof Shape</p>
              <p className="text-[11px] text-slate-500">
                {roofTypeLabel ? `Currently: ${roofTypeLabel}` : 'Select roof geometry'}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className={cn(
                'rounded-md px-2.5 py-1 text-[10px] font-semibold transition-colors',
                roofGalleryOpen ? 'bg-primary/15 text-primary' : 'bg-primary text-white',
              )}>
                {roofGalleryOpen ? 'Collapse' : 'Change Type'}
              </span>
              <ChevronDown className={cn('size-4 shrink-0 text-primary transition-transform duration-200', roofGalleryOpen && 'rotate-180')} />
            </div>
          </button>

          <div className="overflow-hidden" style={{ maxHeight: roofGalleryOpen ? '600px' : '0px', transition: 'max-height 300ms ease-in-out' }}>
            <div className="border-t border-primary/15 px-5 pb-4 pt-3 bg-white/60">
              <RoofTypeCards elements={elements} onApplyRoofType={onApplyRoofType} />
            </div>
          </div>
        </div>
      )}

      {/* ── Sidebar (scrolls) + editor (center, fixed) ── */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <ScrollHintContainer className="w-[200px] shrink-0 border-r border-slate-200 bg-slate-50/60 p-3">
          <div className="flex flex-col gap-2">
            {items.map(renderSidebarCard)}
            <button
              type="button"
              onClick={() => onCreateSurface(groupType)}
              className="flex w-full flex-col items-center justify-center gap-1 rounded-lg border-2 border-dashed border-slate-200 bg-transparent py-3 text-slate-400 transition-colors hover:border-primary/40 hover:bg-primary/5 hover:text-primary cursor-pointer"
            >
              <Plus className="size-4" />
              <span className="text-[10px] font-semibold">Add surface</span>
            </button>
          </div>
        </ScrollHintContainer>

        {/* ScrollHintContainer's className prop only reaches its inner
            scrollable div, not the outer div that's the real flex item here
            — so "flex-1" on it was a no-op and the pane shrank to fit its
            own content instead of filling the row. Wrapping it in a plain
            div that actually receives flex-1/min-w-0 fixes that; the
            "No surface selected" placeholder's own h-full/centering then has
            a correctly-sized box to center within. */}
        <div className="min-w-0 flex-1">
          <ScrollHintContainer className="bg-white">
          {editorSlot ?? (
            <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
              <div className="flex size-12 items-center justify-center rounded-xl border border-slate-200 bg-slate-50">
                <Layers className="size-5 text-slate-300" />
              </div>
              <div>
                <p className="text-sm font-semibold text-slate-600">No surface selected</p>
                <p className="mt-1 text-[11px] leading-snug text-muted-foreground">
                  Pick a surface from the list on the left, or add a new one.
                </p>
              </div>
            </div>
          )}
          </ScrollHintContainer>
        </div>
      </div>
    </div>
  );
}
