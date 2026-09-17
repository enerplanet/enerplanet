/**
 * Building Configurator Design System
 * Shared primitive components and design tokens.
 *
 * Styled with Tailwind CSS + CSS variables to match the EnerPlanET UI.
 * Radix UI is used for Tooltip and Switch; all other components are plain HTML.
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogTitle,
  Switch,
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@spatialhub/ui';
import { Info, ChevronDown } from 'lucide-react';
import { cn } from '@spatialhub/ui';

// ─── Design tokens — CSS variable references for use in SVG attributes ─────────
// SVG stroke/fill attributes accept var() directly, so these strings work as-is.

export const T = {
  card:        'var(--color-card)',
  background:  'var(--color-background)',
  foreground:  'var(--color-foreground)',
  muted:       'var(--color-muted)',
  mutedFg:     'var(--color-muted-foreground)',
  border:      'var(--color-border)',
  primary:     'var(--color-primary)',
  primaryFg:   'var(--color-primary-foreground)',
  inputBg:     'var(--color-input-background)',
  switchBg:    'var(--color-switch-background)',
  destructive: 'var(--color-destructive)',
  warning:     '#92400e',
};

// ─── Element type badge colours ────────────────────────────────────────────────

export const TYPE_BADGES: Record<string, { bg: string; fg: string; border: string }> = {
  wall:   { bg: '#eff6ff', fg: '#1d4ed8', border: '#bfdbfe' },
  window: { bg: '#f0f9ff', fg: '#0369a1', border: '#bae6fd' },
  roof:   { bg: '#fffbeb', fg: '#b45309', border: '#fde68a' },
  floor:  { bg: '#f0fdf4', fg: '#15803d', border: '#bbf7d0' },
  door:   { bg: '#fff7ed', fg: '#c2410c', border: '#fed7aa' },
};

// ─── Element dot colours ───────────────────────────────────────────────────────

export const ELEMENT_DOTS: Record<string, string> = {
  wall:   '#8ab4d0',
  window: '#56bce0',
  roof:   '#c0a870',
  floor:  '#608c4c',
  door:   '#8a5a38',
};

// ─── ConfiguratorStyles — no-op; styles are now in theme.css ──────────────────

/** @deprecated Styles are now in theme.css. This component is kept for compatibility. */
export function ConfiguratorStyles() {
  return null;
}

// ─── InfoTip ──────────────────────────────────────────────────────────────────

export function InfoTip({ tip }: { tip: string }) {
  return (
    // The app mounts one TooltipProvider at its root, so this needs none.
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center cursor-help shrink-0">
          <Info className="size-3 text-muted-foreground" />
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-[200px] text-[11px] leading-snug">
        {tip}
      </TooltipContent>
    </Tooltip>
  );
}

// ─── HeatingDeltaBadge ────────────────────────────────────────────────────────

/**
 * Percentages beyond DELTA_DISPLAY_CAP are shown as ">300%" rather than the
 * raw figure — while BuEM and the building's data are still placeholders, a
 * comparison between two disconnected estimates can produce swings in the
 * thousands of percent, which is noise, not a real signal, and reads as broken.
 */
const DELTA_DISPLAY_CAP = 300;

/**
 * Small tag next to an energy row's label naming where its number came
 * from. Nothing is shown for 'buem' — a confirmed full simulation is the
 * ordinary/default state and doesn't need calling out.
 */
export function SourceTag({ source }: { source?: 'ignis' | 'buem' | 'user' }) {
  if (source === 'ignis') return <span className="ml-1.5 text-[10px] font-medium text-slate-400">estimated</span>;
  if (source === 'user') return <span className="ml-1.5 text-[10px] font-medium text-slate-400">user defined</span>;
  return null;
}

/**
 * One-line plain-language comparison — "26% lower than the last full
 * simulation (24,955 kWh)" — replacing a bare percentage badge with wording
 * a non-CS reader can act on. Caller decides when there's something worth
 * saying (e.g. only while the number differs from a reference); this just
 * renders it.
 */
export function EnergyComparisonNote({
  deltaPercent, referenceKwh, referenceLabel,
}: {
  deltaPercent?: number | null;
  referenceKwh?: string;
  referenceLabel?: string;
}) {
  if (deltaPercent === null || deltaPercent === undefined || !referenceKwh || !referenceLabel) return null;
  if (Math.abs(deltaPercent) < 0.5) return null;

  const isIncrease = deltaPercent > 0;
  const magnitude = Math.abs(deltaPercent);
  const displayValue = magnitude > DELTA_DISPLAY_CAP ? `>${DELTA_DISPLAY_CAP}` : magnitude.toFixed(0);

  return (
    <p className={cn('text-[11px] leading-snug', isIncrease ? 'text-red-400' : 'text-emerald-400')}>
      {displayValue}% {isIncrease ? 'higher' : 'lower'} than {referenceLabel} ({referenceKwh} kWh)
    </p>
  );
}

// ─── NumberInput ──────────────────────────────────────────────────────────────

interface NumberInputProps {
  label?: string;
  value: number | string;
  onChange?: (v: number) => void;
  unit: string;
  min?: number;
  max?: number;
  step?: number;
  tip?: string;
  readOnly?: boolean;
  width?: number | string;
}

export function NumberInput({
  label, value, onChange, unit, min, max, step = 0.01,
  tip, readOnly = false, width,
}: NumberInputProps) {
  return (
    <div style={width !== undefined ? { width } : undefined}>
      {label && (
        <div className="flex items-center gap-1 mb-1">
          <span className="text-[11px] font-medium text-muted-foreground leading-tight">{label}</span>
          {tip && <InfoTip tip={tip} />}
        </div>
      )}
      <div className="cfg-input-wrap">
        <input
          className="cfg-number"
          type="number"
          value={value}
          min={min}
          max={max}
          step={step}
          readOnly={readOnly}
          onChange={(e) => {
            if (!onChange) return;
            const v = parseFloat(e.target.value);
            if (!isNaN(v)) onChange(v);
          }}
          style={{ cursor: readOnly ? 'default' : 'text' }}
        />
        <div className="px-2.5 flex items-center justify-center bg-muted border-l border-border text-[11px] text-muted-foreground whitespace-nowrap shrink-0 select-none">
          {unit}
        </div>
      </div>
    </div>
  );
}

// ─── SelectInput ──────────────────────────────────────────────────────────────

interface SelectInputProps {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  options: string[] | { value: string; label: string }[];
  tip?: string;
}

export function SelectInput({ label, value, onChange, options, tip }: SelectInputProps) {
  const normalized = (options as any[]).map((o) =>
    typeof o === 'string' ? { value: o, label: o } : o
  );
  return (
    <div>
      {label && (
        <div className="flex items-center gap-1 mb-1">
          <span className="text-[11px] font-medium text-muted-foreground leading-tight">{label}</span>
          {tip && <InfoTip tip={tip} />}
        </div>
      )}
      <select
        className="cfg-select"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        {normalized.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </div>
  );
}

// ─── SegmentedControl ─────────────────────────────────────────────────────────

interface SegOpt { value: string; label: string }

interface SegmentedControlProps {
  options: SegOpt[];
  value: string;
  onChange: (v: string) => void;
  fullWidth?: boolean;
}

export function SegmentedControl({ options, value, onChange, fullWidth }: SegmentedControlProps) {
  return (
    <div className={cn(
      'inline-flex bg-muted rounded-[6px] p-0.5 gap-0.5',
      fullWidth && 'flex w-full',
    )}>
      {options.map((opt) => {
        const active = value === opt.value;
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => onChange(opt.value)}
            className={cn(
              'px-3 py-[5px] rounded-[5px] text-xs select-none cursor-pointer transition-all duration-150 whitespace-nowrap',
              fullWidth && 'flex-1',
              active
                ? 'bg-card text-foreground font-semibold shadow-sm'
                : 'text-muted-foreground font-normal hover:text-foreground',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// ─── RangeSlider ─────────────────────────────────────────────────────────────

interface RangeMark { value: number; label: string }

interface RangeSliderProps {
  value: number;
  min: number;
  max: number;
  step?: number;
  marks?: RangeMark[];
  onChange: (v: number) => void;
}

export function RangeSlider({ value, min, max, step = 1, marks, onChange }: RangeSliderProps) {
  return (
    <div>
      <input
        className="cfg-range"
        type="range"
        value={value}
        min={min}
        max={max}
        step={step}
        onChange={(e) => onChange(parseFloat(e.target.value))}
      />
      {marks && (
        <div className="flex justify-between mt-0.5">
          {marks.map((m) => (
            <span key={m.value} className="text-[10px] text-muted-foreground leading-none">
              {m.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── ToggleSwitch ─────────────────────────────────────────────────────────────

interface ToggleSwitchProps {
  checked: boolean;
  onChange: (v: boolean) => void;
  label?: string;
  tip?: string;
}

export function ToggleSwitch({ checked, onChange, label, tip }: ToggleSwitchProps) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex items-center gap-1.5">
        <span className="text-xs text-foreground">{label}</span>
        {tip && <InfoTip tip={tip} />}
      </div>
      <Switch checked={checked} onCheckedChange={onChange} className="cursor-pointer" />
    </div>
  );
}

// ─── SectionLabel ─────────────────────────────────────────────────────────────

export function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span className="text-[11px] font-semibold text-muted-foreground tracking-[0.08em] uppercase block">
      {children}
    </span>
  );
}

// ─── ConfigSection (accordion) ────────────────────────────────────────────────

interface ConfigSectionProps {
  title: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}

export function ConfigSection({ title, expanded, onToggle, children }: ConfigSectionProps) {
  return (
    <div className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-[0_12px_28px_rgba(15,23,42,0.05)]">
      <button
        type="button"
        onClick={onToggle}
        className="flex h-11 w-full items-center justify-between bg-slate-50 px-3 cursor-pointer select-none transition-colors duration-100 hover:bg-muted"
      >
        <span className="text-[11px] font-semibold text-muted-foreground tracking-[0.08em] uppercase">
          {title}
        </span>
        <ChevronDown
          className={cn(
            'size-4 text-muted-foreground transition-transform duration-300 ease-out',
            expanded && 'rotate-180',
          )}
        />
      </button>

      <div className={cn(
        'overflow-hidden transition-[max-height] duration-300 ease-in-out',
        expanded ? 'max-h-[600px]' : 'max-h-0',
      )}>
        <div className={cn('bg-white px-3 pb-3 pt-1.5', expanded && 'border-t border-border/80')}>
          {children}
        </div>
      </div>
    </div>
  );
}

// ─── FieldRow — 2-column grid ─────────────────────────────────────────────────

export function FieldRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {children}
    </div>
  );
}

// ─── FieldLabel ───────────────────────────────────────────────────────────────

export function FieldLabel({ children, tip }: { children: React.ReactNode; tip?: string }) {
  return (
    <div className="flex items-center gap-1 mb-1">
      <span className="text-[11px] font-medium text-muted-foreground leading-tight">{children}</span>
      {tip && <InfoTip tip={tip} />}
    </div>
  );
}

// ─── TypeBadge ────────────────────────────────────────────────────────────────

export function TypeBadge({ type }: { type: string }) {
  const b = TYPE_BADGES[type] ?? { bg: 'var(--color-muted)', fg: 'var(--color-muted-foreground)', border: 'var(--color-border)' };
  return (
    <span
      className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold capitalize"
      style={{ backgroundColor: b.bg, color: b.fg, border: `1px solid ${b.border}` }}
    >
      {type}
    </span>
  );
}

// ─── InlineStepper ────────────────────────────────────────────────────────────

interface InlineStepperProps {
  label: string;
  value: number;
  min?: number;
  onDecrement: () => void;
  onIncrement: () => void;
}

export function InlineStepper({ label, value, min = 1, onDecrement, onIncrement }: InlineStepperProps) {
  const canDecrement = value > min;
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[11px] font-medium text-muted-foreground flex-1">{label}</span>
      <button
        type="button"
        onClick={() => canDecrement && onDecrement()}
        className={cn(
          'size-7 border border-border rounded-md flex items-center justify-center text-lg text-foreground select-none transition-colors',
          canDecrement ? 'cursor-pointer hover:bg-muted' : 'cursor-not-allowed opacity-40',
        )}
      >
        −
      </button>
      <span className="text-sm font-bold text-foreground w-8 text-center">{value}</span>
      <button
        type="button"
        onClick={onIncrement}
        className="size-7 border border-border rounded-md flex items-center justify-center text-lg text-foreground cursor-pointer hover:bg-muted select-none transition-colors"
      >
        +
      </button>
    </div>
  );
}

// ─── Scroll hint container ────────────────────────────────────────────────────

/**
 * Wraps a scrollable content area and shows a gradient fade + chevron arrow at
 * the bottom whenever the content overflows below the visible edge.
 * The hint fades out smoothly once the user scrolls to the bottom.
 *
 * Usage: replace the scrollable outer div of a panel with this component.
 * The `className` prop is forwarded to the inner scrollable div (use it for
 * padding, flex direction, etc. — the outer div fills the available space).
 */
export function ScrollHintContainer({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const scrollRef  = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const rafRef     = useRef<number | null>(null);
  const [showHint, setShowHint] = useState(false);

  const check = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setShowHint(el.scrollHeight - el.clientHeight - el.scrollTop > 8);
  }, []);

  // Debounce via rAF so the check always runs after the browser has painted.
  const scheduleCheck = useCallback(() => {
    if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => { rafRef.current = null; check(); });
  }, [check]);

  useEffect(() => {
    const el      = scrollRef.current;
    const content = contentRef.current;
    if (!el) return;

    // Scroll events — immediate is fine here; layout is already done.
    el.addEventListener('scroll', check, { passive: true });

    // Observe the outer container (catches window resize).
    const roOuter = new ResizeObserver(scheduleCheck);
    roOuter.observe(el);

    // Observe the inner content wrapper (catches content additions / accordion opens).
    const roInner = new ResizeObserver(scheduleCheck);
    if (content) roInner.observe(content);

    // Initial check — deferred so the browser has finished its first layout pass.
    scheduleCheck();

    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      el.removeEventListener('scroll', check);
      roOuter.disconnect();
      roInner.disconnect();
    };
  }, [check, scheduleCheck]);

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <div ref={scrollRef} className={cn('h-full overflow-y-auto', className)}>
        {/* Content wrapper — observed so the hint reacts when sections expand.
            h-full (not min-h-full — that doesn't reliably give descendants a
            definite height to resolve percentage heights against) so a short
            child using h-full (e.g. a centered empty state) actually gets a
            height to center against, instead of collapsing to its own
            content size and rendering pinned at the top. Safe for taller
            content too: overflow stays visible, so it still spills past this
            box and still counts toward the scrollable ancestor's
            scrollHeight, same as before. */}
        <div ref={contentRef} className="h-full">
          {children}
        </div>
      </div>

      {/* Scroll hint — visible whenever content overflows below the fold */}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 flex flex-col items-center justify-end pb-3 transition-opacity duration-200',
          showHint ? 'opacity-100' : 'opacity-0',
        )}
        style={{
          height: 80,
          background: 'linear-gradient(to top, rgba(241,245,249,1) 0%, rgba(241,245,249,0.85) 40%, transparent 100%)',
        }}
      >
        {/* Pill badge — clearly visible against the gradient */}
        <div className="flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2.5 py-1 shadow-sm">
          <ChevronDown className="size-3.5 text-slate-500" />
          <span className="text-[10px] font-semibold text-slate-500">scroll</span>
        </div>
      </div>
    </div>
  );
}

// ─── Element configurator modal ────────────────────────────────────────────────

/**
 * Blurred-backdrop overlay that hosts a single element's editor (a surface
 * group, PV, battery, or the building's advanced settings). Replaces the old
 * persistent "active editor" column — the editor now only exists while the
 * user is actively configuring one thing, instead of always occupying space.
 */
const MODAL_SIZE = {
  default: 'h-[min(760px,85vh)] w-[min(1060px,94vw)]',
  // Battery has far less content than the other panels (building/surfaces/PV)
  // and was leaving most of the default-sized modal blank.
  compact: 'h-[min(520px,80vh)] w-[min(640px,94vw)]',
  // Surface-group editor: a fixed 200px sidebar list + one surface's
  // properties form — neither needs the full default width, which left a
  // few hundred px of blank card on the right. Height stays fairly tall
  // since groups with many surfaces (or Roof's expandable type gallery)
  // still need room; the sidebar/editor panes scroll independently anyway.
  medium: 'h-[min(660px,85vh)] w-[min(820px,94vw)]',
} as const;

export function ElementConfiguratorModal({
  open,
  onClose,
  title,
  children,
  size = 'default',
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  size?: keyof typeof MODAL_SIZE;
}) {
  return (
    <Dialog open={open} onOpenChange={(next: boolean) => { if (!next) onClose(); }}>
      {/* DialogContent brings its own portal, overlay and close button; the
          overrides undo its padded grid so a stage fills the panel. */}
      <DialogContent
        className={cn(
          'flex flex-col gap-0 overflow-hidden p-0 sm:max-w-none',
          MODAL_SIZE[size],
        )}
      >
        <DialogTitle className="sr-only">{title}</DialogTitle>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {children}
        </div>
      </DialogContent>
    </Dialog>
  );
}
