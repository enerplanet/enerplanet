// Right column of the Overview view: load profile chart (pinned) + building details card (scrolls).

import { ScrollHintContainer } from '@/features/configurator/building-config/panel/shared/ui';
import { LoadProfileViewer } from './LoadProfileViewer';
import { BuildingDetailsCard } from './BuildingDetailsCard';
import type { BuildingElement } from '@/features/configurator/building-config/panel/configure/model/buildingElements';
import type { RoofConfig } from '@/features/configurator/building-config/panel/configure/model/roof';
import type { ElementGroupKey } from '@/features/configurator/building-config/panel/shared/elementListUtils';
import type { SnapshotRow } from '@/features/configurator/building-config/panel/shared/snapshotUtils';
import type { LoadDataPoint } from '@/features/configurator/building-config/panel/lib/loadProfile';

export interface EnergyEnvelopeColumnProps {
  uploadError: string | null;
  onClearError: () => void;
  elements: Record<string, BuildingElement>;
  baselineElements?: Record<string, BuildingElement>;
  roofConfig: RoofConfig;
  /** Re-triggers the scroll indicator check when the panel becomes visible. */
  isActive: boolean;
  buildingId: string;
  /** Pre-seeded hourly timeseries from the model. Null means no model data yet. */
  initialTimeseries: LoadDataPoint[] | null;
  mode: 'basic' | 'expert';
  snapshotRows: SnapshotRow[];
  /** Commits a single field's new value (key maps to the `general` state object). */
  onEditField?: (key: string, value: string | number) => void;
  /** Opens the building's advanced settings (site, ventilation, thermal, ignis heat demand, ...). */
  onOpenAdvanced?: () => void;
  /** Fired when the user uploads a load profile — becomes ground truth for the annual totals elsewhere. */
  onGroundTruthChange?: (rows: LoadDataPoint[] | null, label: string | null) => void;
  /** Opens the surface configurator modal for an envelope group (walls, windows, ...). */
  onEditGroup?: (type: ElementGroupKey) => void;
}

/** Right panel of the overview: energy chart pinned above, building details card scrolling below. */
export function EnergyEnvelopeColumn({
  uploadError,
  onClearError,
  elements,
  baselineElements,
  roofConfig,
  buildingId,
  initialTimeseries,
  mode,
  snapshotRows,
  onEditField,
  onOpenAdvanced,
  onGroundTruthChange,
  onEditGroup,
}: EnergyEnvelopeColumnProps) {
  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-100">

      {/* ── Pinned: upload error + chart — stays visible, never scrolls out of view ── */}
      <div className="shrink-0">
        {uploadError && (
          <div className="mx-4 mt-4 flex items-start gap-1.5 rounded-md border border-red-200 bg-red-50 px-3 py-2.5">
            <p className="flex-1 text-[11px] leading-snug text-destructive">{uploadError}</p>
            <button
              type="button"
              onClick={onClearError}
              className="shrink-0 cursor-pointer text-sm leading-none text-destructive"
            >×</button>
          </div>
        )}

        {/* ResponsiveContainer requires an explicit parent height. Expert and
            basic now share the same chart layout (see LoadProfileViewer) —
            expert only adds the Hour resolution tab, not extra chrome.
            Same gray backdrop + p-4 margin as the Building Parameters card
            below, so both cards read as the same width on the same background
            instead of the chart sitting in its own mismatched white frame. */}
        <div className="bg-slate-100 p-4 pb-3" style={{ height: 340 }}>
          <LoadProfileViewer
            buildingId={buildingId}
            initialTimeseries={initialTimeseries ?? undefined}
            mode={mode}
            onGroundTruthChange={onGroundTruthChange}
          />
        </div>
      </div>

      {/* ── Scrolls independently below the pinned chart ── */}
      <ScrollHintContainer className="border-t border-border/60 bg-slate-100 p-4
          [&::-webkit-scrollbar]:w-2.5
          [&::-webkit-scrollbar-track]:bg-transparent
          [&::-webkit-scrollbar-thumb]:rounded-full
          [&::-webkit-scrollbar-thumb]:bg-slate-300
          hover:[&::-webkit-scrollbar-thumb]:bg-slate-400">
        <BuildingDetailsCard
          snapshotRows={snapshotRows}
          onEditField={onEditField}
          onOpenAdvanced={onOpenAdvanced}
          elements={elements}
          baselineElements={baselineElements}
          roofConfig={roofConfig}
          onEditGroup={onEditGroup}
        />
      </ScrollHintContainer>
    </div>
  );
}
