"use client"

import { ComponentProps } from "react"
import { getLocalTimeZone, today } from "@internationalized/date"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import {
  Button,
  CalendarCell as CalendarCellRac,
  CalendarGridBody as CalendarGridBodyRac,
  CalendarGridHeader as CalendarGridHeaderRac,
  CalendarGrid as CalendarGridRac,
  CalendarHeaderCell as CalendarHeaderCellRac,
  CalendarMonthPicker,
  CalendarYearPicker,
  composeRenderProps,
  RangeCalendar as RangeCalendarRac,
} from "react-aria-components"

import { cn } from "@/lib/utils/index"

interface BaseCalendarProps {
  className?: string
}

type RangeCalendarProps = ComponentProps<typeof RangeCalendarRac> &
  BaseCalendarProps & {
    minYear?: number
    maxYear?: number
  }

const PICKER_SELECT =
  "h-8 rounded-md border border-input bg-background px-2 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"

function CalendarHeader({ minYear, maxYear }: Readonly<{ minYear: number; maxYear: number }>) {
  return (
    <header className="flex w-full items-center gap-1 pb-1">
      <Button
        slot="previous"
        className="text-muted-foreground/80 hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 flex size-9 items-center justify-center rounded-md transition-[color,box-shadow] outline-none focus-visible:ring-[3px]"
      >
        <ChevronLeftIcon size={16} />
      </Button>
      {/* RangeCalendar commits a half-picked range on any pointerup inside it that
          is not on a button, so the selects keep theirs: they only move the view. */}
      <div className="flex grow justify-center gap-1" onPointerUp={(e) => e.stopPropagation()}>
        <CalendarMonthPicker format="long">
          {({ items, value, onChange, "aria-label": label }) => (
            <select aria-label={label} value={String(value)} onChange={(e) => onChange(Number(e.target.value))} className={PICKER_SELECT}>
              {items.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.formatted}
                </option>
              ))}
            </select>
          )}
        </CalendarMonthPicker>
        <CalendarYearPicker visibleYears={2 * (maxYear - minYear) + 1}>
          {({ items, value, onChange, "aria-label": label }) => (
            <select aria-label={label} value={String(value)} onChange={(e) => onChange(Number(e.target.value))} className={PICKER_SELECT}>
              {items
                .filter((item) => item.date.year >= minYear && item.date.year <= maxYear)
                .map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.formatted}
                  </option>
                ))}
            </select>
          )}
        </CalendarYearPicker>
      </div>
      <Button
        slot="next"
        className="text-muted-foreground/80 hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 flex size-9 items-center justify-center rounded-md transition-[color,box-shadow] outline-none focus-visible:ring-[3px]"
      >
        <ChevronRightIcon size={16} />
      </Button>
    </header>
  )
}

function CalendarGridComponent({ isRange = false }: Readonly<{ isRange?: boolean }>) {
  const now = today(getLocalTimeZone())

  return (
    <CalendarGridRac>
      <CalendarGridHeaderRac>
        {(day) => (
          <CalendarHeaderCellRac className="text-muted-foreground/80 size-9 rounded-md p-0 text-xs font-medium">
            {day}
          </CalendarHeaderCellRac>
        )}
      </CalendarGridHeaderRac>
      <CalendarGridBodyRac className="[&_td]:px-0 [&_td]:py-px">
        {(date) => (
          <CalendarCellRac
            date={date}
            className={cn(
              "text-foreground data-hovered:bg-accent data-selected:bg-primary data-hovered:text-foreground data-selected:text-primary-foreground data-focus-visible:ring-ring/50 relative flex size-9 items-center justify-center rounded-md p-0 text-sm font-normal whitespace-nowrap [transition-property:color,background-color,border-radius,box-shadow] duration-150 outline-none data-disabled:pointer-events-none data-disabled:opacity-30 data-focus-visible:z-10 data-focus-visible:ring-[3px] data-unavailable:pointer-events-none data-unavailable:line-through data-unavailable:opacity-30",
              // Range-specific styles
              isRange &&
                "data-selected:bg-accent data-selected:text-foreground data-invalid:data-selection-end:bg-destructive data-invalid:data-selection-start:bg-destructive data-selection-end:bg-primary data-selection-start:bg-primary data-selection-end:text-primary-foreground data-selection-start:text-primary-foreground data-invalid:bg-red-100 data-selected:rounded-none data-selection-end:rounded-e-md data-invalid:data-selection-end:text-white data-selection-start:rounded-s-md data-invalid:data-selection-start:text-white",
              // Today indicator styles
              date.compare(now) === 0 &&
                cn(
                  "after:bg-primary after:pointer-events-none after:absolute after:start-1/2 after:bottom-1 after:z-10 after:size-[3px] after:-translate-x-1/2 after:rounded-full",
                  isRange
                    ? "data-selection-end:after:bg-background data-selection-start:after:bg-background"
                    : "data-selected:after:bg-background"
                )
            )}
          />
        )}
      </CalendarGridBodyRac>
    </CalendarGridRac>
  )
}

function RangeCalendar({ className, minYear = 1980, maxYear = 2025, ...props }: RangeCalendarProps) {
  return (
    <RangeCalendarRac
      {...props}
      className={composeRenderProps(className, (className) =>
        cn("w-fit", className)
      )}
    >
      <CalendarHeader minYear={minYear} maxYear={maxYear} />
      {/* Room for a header row and six weeks, so the popover keeps its height in every month. */}
      <div className="min-h-[calc(2.25rem_+_6*(2.25rem_+_2px))]">
        <CalendarGridComponent isRange />
      </div>
    </RangeCalendarRac>
  )
}

export { RangeCalendar }
