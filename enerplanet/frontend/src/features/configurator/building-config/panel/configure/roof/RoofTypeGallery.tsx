// Visual roof-type picker for the Configure view center panel.
// Shown when the user clicks "Type" on the Roof group in the panel selector.
// Selecting a type regenerates all roof elements from predefined surface templates,
// preserving total area and U-value from the existing roof elements.

import { cn } from '@spatialhub/ui';
import { ScrollHintContainer } from '@/features/configurator/building-config/panel/shared/ui';
import type { BuildingElement } from '@/features/configurator/building-config/panel/configure/model/buildingElements';

// ─── Roof type definitions ────────────────────────────────────────────────────

export type RoofType = 'flat' | 'shed' | 'gable' | 'hip' | 'pyramid' | 'mansard';

interface RoofSurfaceTemplate {
  suffix: string;
  label: string;
  tilt: number;
  azimuth: number;
  /** Fraction of total roof area assigned to this surface. Must sum to 1.0. */
  areaFraction: number;
}

interface RoofTypeDefinition {
  id: RoofType;
  label: string;
  description: string;
  surfaces: RoofSurfaceTemplate[];
}

const ROOF_DEFINITIONS: RoofTypeDefinition[] = [
  {
    id: 'flat',
    label: 'Flat',
    description: '1 surface · ~3° drainage slope',
    surfaces: [
      { suffix: 'top', label: 'Flat Roof', tilt: 3, azimuth: 180, areaFraction: 1.0 },
    ],
  },
  {
    id: 'shed',
    label: 'Shed',
    description: '1 surface · mono-pitch, 15°',
    surfaces: [
      { suffix: 'south', label: 'Shed Roof', tilt: 15, azimuth: 180, areaFraction: 1.0 },
    ],
  },
  {
    id: 'gable',
    label: 'Gable',
    description: '2 surfaces · ridge at centre, 35°',
    surfaces: [
      { suffix: 'south', label: 'Gable South', tilt: 35, azimuth: 180, areaFraction: 0.5 },
      { suffix: 'north', label: 'Gable North', tilt: 35, azimuth: 0,   areaFraction: 0.5 },
    ],
  },
  {
    id: 'hip',
    label: 'Hip',
    description: '4 surfaces · slopes on all sides, 35°',
    surfaces: [
      { suffix: 'south', label: 'Hip South', tilt: 35, azimuth: 180, areaFraction: 0.35 },
      { suffix: 'north', label: 'Hip North', tilt: 35, azimuth: 0,   areaFraction: 0.35 },
      { suffix: 'east',  label: 'Hip East',  tilt: 35, azimuth: 90,  areaFraction: 0.15 },
      { suffix: 'west',  label: 'Hip West',  tilt: 35, azimuth: 270, areaFraction: 0.15 },
    ],
  },
  {
    id: 'pyramid',
    label: 'Pyramid',
    description: '4 equal surfaces · apex at centre, 45°',
    surfaces: [
      { suffix: 'south', label: 'Pyramid South', tilt: 45, azimuth: 180, areaFraction: 0.25 },
      { suffix: 'north', label: 'Pyramid North', tilt: 45, azimuth: 0,   areaFraction: 0.25 },
      { suffix: 'east',  label: 'Pyramid East',  tilt: 45, azimuth: 90,  areaFraction: 0.25 },
      { suffix: 'west',  label: 'Pyramid West',  tilt: 45, azimuth: 270, areaFraction: 0.25 },
    ],
  },
  {
    id: 'mansard',
    label: 'Mansard',
    description: '5 surfaces · steep lower slopes + flat upper deck',
    surfaces: [
      { suffix: 'south', label: 'Mansard South', tilt: 70, azimuth: 180, areaFraction: 0.20 },
      { suffix: 'north', label: 'Mansard North', tilt: 70, azimuth: 0,   areaFraction: 0.20 },
      { suffix: 'east',  label: 'Mansard East',  tilt: 70, azimuth: 90,  areaFraction: 0.15 },
      { suffix: 'west',  label: 'Mansard West',  tilt: 70, azimuth: 270, areaFraction: 0.15 },
      { suffix: 'deck',  label: 'Mansard Deck',  tilt: 3,  azimuth: 180, areaFraction: 0.30 },
    ],
  },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Infers the current roof type from the existing set of roof elements. */
export function detectRoofType(roofElements: BuildingElement[]): RoofType | null {
  const count = roofElements.length;
  if (count === 0) return null;
  if (count === 1) {
    return roofElements[0].tilt <= 5 ? 'flat' : 'shed';
  }
  if (count === 2) return 'gable';
  if (count === 4) {
    const avgTilt = roofElements.reduce((s, e) => s + e.tilt, 0) / 4;
    return avgTilt > 40 ? 'pyramid' : 'hip';
  }
  if (count === 5) return 'mansard';
  return null;
}

/**
 * Generates a fresh set of roof BuildingElement records for the given type.
 * Total area and U-value are taken from the caller so they are preserved on switch.
 */
export function generateRoofElements(
  roofType: RoofType,
  totalArea: number,
  uValue: number,
): Record<string, BuildingElement> {
  const def = ROOF_DEFINITIONS.find((d) => d.id === roofType);
  if (!def) return {};

  const result: Record<string, BuildingElement> = {};
  for (const surface of def.surfaces) {
    const id = `roof_${roofType}_${surface.suffix}`;
    result[id] = {
      id,
      label: surface.label,
      type: 'roof',
      area: +(totalArea * surface.areaFraction).toFixed(1),
      uValue,
      gValue: null,
      tilt: surface.tilt,
      azimuth: surface.azimuth,
      source: 'default',
      customMode: false,
    };
  }
  return result;
}

// ─── SVG icons ────────────────────────────────────────────────────────────────

/** Side-elevation (front view) SVG for each roof type. */
function ElevationSvg({ type, selected }: { type: RoofType; selected: boolean }) {
  const roofFill   = selected ? '#2f5d8a' : '#64748b';
  const roofFade   = selected ? 'rgba(47,93,138,0.45)' : 'rgba(100,116,139,0.38)';
  const wallFill   = '#f1f5f9';
  const wallStroke = '#cbd5e1';

  return (
    <svg viewBox="0 0 70 44" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full">
      <rect x="6" y="28" width="58" height="12" rx="1" fill={wallFill} stroke={wallStroke} strokeWidth="0.8" />

      {type === 'flat' && (
        <rect x="4" y="23" width="62" height="6" rx="1" fill={roofFill} />
      )}
      {type === 'shed' && (
        <polygon points="6,28 6,13 64,26 64,28" fill={roofFill} />
      )}
      {type === 'gable' && (
        <polygon points="6,28 35,10 64,28" fill={roofFill} />
      )}
      {type === 'hip' && (
        <>
          <polygon points="6,28 16,16 54,16 64,28" fill={roofFill} />
          <line x1="6"  y1="28" x2="16" y2="16" stroke="white" strokeWidth="0.8" strokeOpacity="0.5" />
          <line x1="64" y1="28" x2="54" y2="16" stroke="white" strokeWidth="0.8" strokeOpacity="0.5" />
        </>
      )}
      {type === 'pyramid' && (
        <>
          <polygon points="6,28 35,10 64,28" fill={roofFill} />
          <polygon points="64,28 35,10 52,20" fill={roofFade} />
        </>
      )}
      {type === 'mansard' && (
        <path d="M 6,28 L 14,18 L 14,13 L 56,13 L 56,18 L 64,28 Z" fill={roofFill} />
      )}
    </svg>
  );
}

/**
 * Plan (top-down) SVG for each roof type using standard architectural roof
 * plan symbols — ridge lines, hip lines, and concentric outlines.
 */
function PlanSvg({ type, selected }: { type: RoofType; selected: boolean }) {
  const fill   = selected ? '#2f5d8a' : '#64748b';
  const stroke = selected ? '#2f5d8a' : '#64748b';
  const white  = 'white';

  // Footprint: x=4, y=4, w=54, h=36; center at (31, 22)
  const [lx, ty, rw, rh] = [4, 4, 54, 36];
  const [rx, by]  = [lx + rw, ty + rh];
  const [cx, cy]  = [lx + rw / 2, ty + rh / 2];

  return (
    <svg viewBox="0 0 62 44" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-full">
      {/* Footprint outline — same for all */}
      <rect x={lx} y={ty} width={rw} height={rh} rx="1" stroke={stroke} strokeWidth="1" fill="none" />

      {type === 'flat' && (
        /* Flat: uniform solid fill — no relief lines */
        <rect x={lx + 1} y={ty + 1} width={rw - 2} height={rh - 2} fill={fill} opacity="0.75" />
      )}

      {type === 'shed' && (
        /* Shed: fill with horizontal slope lines; thick line marks the high eave */
        <>
          <rect x={lx + 1} y={ty + 1} width={rw - 2} height={rh - 2} fill={fill} opacity="0.22" />
          {/* High-edge marker at top (north) */}
          <rect x={lx} y={ty} width={rw} height={4.5} rx="1" fill={fill} opacity="0.85" />
          {/* Slope lines */}
          {[14, 20, 26, 32].map((y) => (
            <line key={y} x1={lx + 4} y1={y} x2={rx - 4} y2={y}
              stroke={stroke} strokeWidth="0.65" opacity="0.38" />
          ))}
        </>
      )}

      {type === 'gable' && (
        /* Gable: two halves (N / S) with a centre ridge line */
        <>
          <rect x={lx + 1} y={cy}     width={rw - 2} height={rh / 2 - 1} fill={fill} opacity="0.65" />
          <rect x={lx + 1} y={ty + 1} width={rw - 2} height={rh / 2}     fill={fill} opacity="0.30" />
          <line x1={lx} y1={cy} x2={rx} y2={cy} stroke={white} strokeWidth="1.6" />
        </>
      )}

      {type === 'hip' && (
        /* Hip: four triangular panels meeting at a shortened centre ridge */
        <>
          <rect x={lx + 1} y={ty + 1} width={rw - 2} height={rh - 2} fill={fill} opacity="0.30" />
          {/* Centre ridge */}
          <line x1={lx + 14} y1={cy} x2={rx - 14} y2={cy} stroke={white} strokeWidth="1.6" />
          {/* Hip lines from four corners to ridge ends */}
          <line x1={lx} y1={ty} x2={lx + 14} y2={cy} stroke={white} strokeWidth="0.9" strokeOpacity="0.75" />
          <line x1={rx} y1={ty} x2={rx - 14} y2={cy} stroke={white} strokeWidth="0.9" strokeOpacity="0.75" />
          <line x1={lx} y1={by} x2={lx + 14} y2={cy} stroke={white} strokeWidth="0.9" strokeOpacity="0.75" />
          <line x1={rx} y1={by} x2={rx - 14} y2={cy} stroke={white} strokeWidth="0.9" strokeOpacity="0.75" />
        </>
      )}

      {type === 'pyramid' && (
        /* Pyramid: four equal triangles converging to a single apex point */
        <>
          <rect x={lx + 1} y={ty + 1} width={rw - 2} height={rh - 2} fill={fill} opacity="0.30" />
          <line x1={lx} y1={ty} x2={cx} y2={cy} stroke={white} strokeWidth="0.9" strokeOpacity="0.85" />
          <line x1={rx} y1={ty} x2={cx} y2={cy} stroke={white} strokeWidth="0.9" strokeOpacity="0.85" />
          <line x1={lx} y1={by} x2={cx} y2={cy} stroke={white} strokeWidth="0.9" strokeOpacity="0.85" />
          <line x1={rx} y1={by} x2={cx} y2={cy} stroke={white} strokeWidth="0.9" strokeOpacity="0.85" />
          <circle cx={cx} cy={cy} r="2.2" fill={white} opacity="0.9" />
        </>
      )}

      {type === 'mansard' && (
        /* Mansard: outer steep ring + inner flat deck rectangle */
        <>
          <rect x={lx + 1} y={ty + 1} width={rw - 2} height={rh - 2} fill={fill} opacity="0.28" />
          {/* Inner deck */}
          <rect x={lx + 12} y={ty + 10} width={rw - 24} height={rh - 20} rx="0.5" fill={fill} opacity="0.82" />
          {/* Corner ridge lines connecting outer corners to inner deck corners */}
          <line x1={lx}     y1={ty}    x2={lx + 12} y2={ty + 10} stroke={white} strokeWidth="0.8" strokeOpacity="0.65" />
          <line x1={rx}     y1={ty}    x2={rx - 12} y2={ty + 10} stroke={white} strokeWidth="0.8" strokeOpacity="0.65" />
          <line x1={lx}     y1={by}    x2={lx + 12} y2={by - 10} stroke={white} strokeWidth="0.8" strokeOpacity="0.65" />
          <line x1={rx}     y1={by}    x2={rx - 12} y2={by - 10} stroke={white} strokeWidth="0.8" strokeOpacity="0.65" />
        </>
      )}
    </svg>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

interface RoofTypeGalleryProps {
  elements: Record<string, BuildingElement>;
  /** Called with updated roof elements when the user selects a type. */
  onApplyRoofType: (newRoofElements: Record<string, BuildingElement>) => void;
}

interface RoofTypeCardsProps {
  elements: Record<string, BuildingElement>;
  onApplyRoofType: (newRoofElements: Record<string, BuildingElement>) => void;
}

/** Inline roof-type card grid — no outer scroll wrapper, for embedding inside another panel. */
export function RoofTypeCards({ elements, onApplyRoofType }: RoofTypeCardsProps) {
  const roofElements = Object.values(elements).filter((e) => e.type === 'roof');
  const currentType  = detectRoofType(roofElements);
  const totalArea    = roofElements.reduce((s, e) => s + e.area, 0) || 90;
  const uValue       = roofElements[0]?.uValue ?? 0.18;

  const handleSelect = (roofType: RoofType) => {
    if (roofType === currentType) return;
    onApplyRoofType(generateRoofElements(roofType, totalArea, uValue));
  };

  return (
    <div className="flex flex-col gap-3">
      {roofElements.length > 0 && (
        <p className="text-[11px] text-blue-600">
          Total area <strong>{totalArea.toFixed(1)} m²</strong> and U-value <strong>{uValue} W/m²K</strong> are preserved when switching types.
        </p>
      )}
      <div className="grid grid-cols-3 gap-2">
        {ROOF_DEFINITIONS.map((def) => {
          const isSelected = currentType === def.id;
          return (
            <button
              key={def.id}
              type="button"
              onClick={() => handleSelect(def.id)}
              className={cn(
                'relative flex flex-col gap-1.5 rounded-lg border p-2 text-left transition-all duration-150 cursor-pointer',
                isSelected
                  ? 'border-slate-400 bg-slate-100'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50',
              )}
            >
              {isSelected && (
                <span className="absolute right-1.5 top-1.5 flex size-3.5 items-center justify-center rounded-full bg-slate-600">
                  <svg className="size-2 text-white" viewBox="0 0 8 8" fill="currentColor"><path d="M1 4l2 2 4-4"/></svg>
                </span>
              )}
              <p className={cn('text-center text-[12px] font-bold leading-tight', isSelected ? 'text-primary' : 'text-slate-800')}>
                {def.label}
              </p>
              <div className="flex w-full gap-1">
                <div className="flex flex-1 flex-col gap-0.5">
                  <ElevationSvg type={def.id} selected={isSelected} />
                  <span className="text-center text-[9px] text-slate-400">Side</span>
                </div>
                <div className="w-px self-stretch bg-slate-300" />
                <div className="flex flex-1 flex-col gap-0.5">
                  <PlanSvg type={def.id} selected={isSelected} />
                  <span className="text-center text-[9px] text-slate-400">Top</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Visual roof-type picker. Regenerates roof elements on selection. */
export function RoofTypeGallery({ elements, onApplyRoofType }: RoofTypeGalleryProps) {
  const roofElements = Object.values(elements).filter((e) => e.type === 'roof');
  const currentType  = detectRoofType(roofElements);
  const totalArea    = roofElements.reduce((s, e) => s + e.area, 0) || 90;
  const uValue       = roofElements[0]?.uValue ?? 0.18;

  const handleSelect = (roofType: RoofType) => {
    if (roofType === currentType) return;
    onApplyRoofType(generateRoofElements(roofType, totalArea, uValue));
  };

  return (
    <ScrollHintContainer className="flex flex-col p-5">

      {/* Header */}
      <div className="mb-5 flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-slate-100">
          {/* Generic roof silhouette icon */}
          <svg viewBox="0 0 20 16" className="size-5 text-slate-500" fill="none">
            <polygon points="1,14 10,2 19,14" fill="currentColor" opacity="0.7" />
          </svg>
        </div>
        <div>
          <p className="text-base font-bold text-slate-800">Roof Type</p>
          <p className="text-[11px] text-muted-foreground">
            Choose a geometry — roof surfaces regenerate automatically
          </p>
        </div>
      </div>

      {/* Preserved values notice */}
      {roofElements.length > 0 && (
        <div className="mb-4 rounded-md border border-blue-100 bg-blue-50 px-3 py-2.5">
          <p className="text-[11px] text-blue-700 leading-snug">
            Total area <strong>{totalArea.toFixed(1)} m²</strong> and U-value <strong>{uValue} W/m²K</strong> are preserved when switching types.
          </p>
        </div>
      )}

      {/* 3 × 2 gallery grid */}
      <div className="grid grid-cols-3 gap-3">
        {ROOF_DEFINITIONS.map((def) => {
          const isSelected = currentType === def.id;
          return (
            <button
              key={def.id}
              type="button"
              onClick={() => handleSelect(def.id)}
              className={cn(
                'flex flex-col gap-2 rounded-xl border p-3 text-left transition-all duration-150 cursor-pointer',
                isSelected
                  ? 'border-primary/60 bg-primary/5 shadow-sm ring-1 ring-primary/20'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50/80',
              )}
            >
              {/* Roof type name — top centre, prominent */}
              <p className={cn(
                'text-center text-[13px] font-bold leading-tight',
                isSelected ? 'text-primary' : 'text-slate-800',
              )}>
                {def.label}
              </p>

              {/* Side elevation + plan view, labels below each figure */}
              <div className="flex w-full gap-1.5">
                <div className="flex flex-1 flex-col gap-0.5">
                  <ElevationSvg type={def.id} selected={isSelected} />
                  <span className="text-center text-[10px] text-slate-400">Side</span>
                </div>
                <div className="w-px self-stretch bg-slate-100" />
                <div className="flex flex-1 flex-col gap-0.5">
                  <PlanSvg type={def.id} selected={isSelected} />
                  <span className="text-center text-[10px] text-slate-400">Top</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </ScrollHintContainer>
  );
}
