// Right column's merged card: Building Parameters table, or Building Envelope
// group cards — one card, one header tab switch, no separate section below.

import { useState } from 'react';
import { Pencil, Check, Settings2 } from 'lucide-react';
import { cn } from '@spatialhub/ui';
import { SnapshotRow, SnapshotStatusBadge } from '../shared/snapshotUtils';
import { NumberInput, SelectInput } from '../shared/ui';
import { MIN_CONSTRUCTION_YEAR } from '../shared/buildingOptions';
import { ElementCompositionSection } from './ElementCompositionSection';
import type { BuildingElement } from '@/features/configurator/building-config/panel/configure/model/buildingElements';
import type { RoofConfig } from '@/features/configurator/building-config/panel/configure/model/roof';
import type { ElementGroupKey } from '../shared/elementListUtils';

// Unit suffix shown for each 'number' editType row — keyed by editKey.
const ROW_UNITS: Record<string, string> = {
  floorArea:  'm²',
  storeys:    '',
  roomHeight: 'm',
  constructionYear: '',
};

const CARD = 'overflow-hidden rounded-xl border border-border/60 bg-white shadow-[0_1px_3px_rgba(15,23,42,0.07),0_4px_16px_rgba(15,23,42,0.08)]';

export interface BuildingDetailsCardProps {
  snapshotRows: SnapshotRow[];
  /** Commits a single field's new value (key maps to the `general` state object). */
  onEditField?: (key: string, value: string | number) => void;
  /** Opens the building's advanced settings (site, ventilation, thermal, ignis heat demand, ...). */
  onOpenAdvanced?: () => void;
  elements: Record<string, BuildingElement>;
  baselineElements?: Record<string, BuildingElement>;
  roofConfig: RoofConfig;
  /** Opens the surface configurator modal for an envelope group (walls, windows, ...). */
  onEditGroup?: (type: ElementGroupKey) => void;
}

/** Building parameters table, or building envelope cards — one merged card. */
export function BuildingDetailsCard({
  snapshotRows,
  onEditField,
  onOpenAdvanced,
  elements,
  baselineElements,
  roofConfig,
  onEditGroup,
}: BuildingDetailsCardProps) {
  // Off by default — edits only ever apply while explicitly toggled on, so a stray
  // click on the table never changes the building's data.
  const [isEditing, setIsEditing] = useState(false);
  const [activeTab, setActiveTab] = useState<'parameters' | 'envelope'>('parameters');

  return (
    <div className={cn(CARD, 'shrink-0')}>
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <p className="text-[13px] font-bold text-slate-800">
          {activeTab === 'envelope' ? 'Building Envelope' : 'Building Parameters'}
        </p>
        <div className="flex items-center gap-3">
          {/* Plain menu-bar tabs — not a filled segmented-control pill, just
              two labelled buttons with an underline on the active one.
              Parameters is the default/first option, Envelope the second. */}
          <div className="flex items-center gap-4">
            {(['parameters', 'envelope'] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setActiveTab(tab)}
                className={cn(
                  'cursor-pointer border-b-2 pb-0.5 text-xs transition-colors',
                  activeTab === tab
                    ? 'border-primary font-semibold text-foreground'
                    : 'border-transparent font-medium text-muted-foreground hover:text-foreground',
                )}
              >
                {tab === 'parameters' ? 'Parameters' : 'Envelope'}
              </button>
            ))}
          </div>
          {onOpenAdvanced && (
            <button
              type="button"
              onClick={onOpenAdvanced}
              className="flex cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 px-2.5 py-1 text-[11px] font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-800"
            >
              <Settings2 className="size-3.5" />
              Advanced
            </button>
          )}
          {activeTab === 'parameters' && onEditField && (
            <button
              type="button"
              onClick={() => setIsEditing((v) => !v)}
              title={isEditing ? 'Done editing' : 'Edit building parameters'}
              className={cn(
                'flex size-7 cursor-pointer items-center justify-center rounded-md transition-colors',
                isEditing ? 'bg-primary text-primary-foreground hover:bg-primary/90' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600',
              )}
            >
              {isEditing ? <Check className="size-3.5" /> : <Pencil className="size-3.5" />}
            </button>
          )}
        </div>
      </div>

      {activeTab === 'parameters' ? (
        <table className="w-full text-sm bg-white">
          <colgroup>
            <col className="w-[42%]" />
            <col />
            <col className="w-20" />
          </colgroup>
          <tbody>
            {snapshotRows.map((row) => {
              const editable = isEditing && onEditField && row.editKey && row.editType;
              return (
                <tr key={row.label} className="border-t border-slate-100">
                  <td className="px-4 py-2.5 text-slate-500">{row.label}</td>
                  <td className="px-4 py-2 text-right font-medium text-slate-700">
                    {editable ? (
                      row.editType === 'select' ? (
                        <SelectInput
                          value={String(row.rawValue ?? '')}
                          onChange={(v) => onEditField!(row.editKey!, v)}
                          options={row.options ?? []}
                        />
                      ) : (
                        <NumberInput
                          value={row.rawValue ?? 0}
                          onChange={(v) => onEditField!(row.editKey!, v)}
                          unit={ROW_UNITS[row.editKey!] ?? ''}
                          min={row.editKey === 'storeys' ? 1 : row.editKey === 'constructionYear' ? MIN_CONSTRUCTION_YEAR : 0}
                          max={row.editKey === 'constructionYear' ? new Date().getFullYear() : undefined}
                          step={row.editKey === 'storeys' ? 1 : row.editKey === 'roomHeight' ? 0.1 : 1}
                        />
                      )
                    ) : row.value}
                  </td>
                  <td className="px-3 py-2 text-center">
                    <SnapshotStatusBadge status={row.status} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <div className="p-4">
          <ElementCompositionSection
            elements={elements}
            baselineElements={baselineElements}
            roofConfig={roofConfig}
            onEditGroup={onEditGroup}
          />
        </div>
      )}
    </div>
  );
}
