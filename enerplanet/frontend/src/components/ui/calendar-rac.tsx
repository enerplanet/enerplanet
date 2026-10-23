"use client"

import { ComponentProps, useContext, useRef } from "react"
import { getLocalTimeZone, today, type CalendarDate } from "@internationalized/date"
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react"
import {
  Button,
  CalendarCell as CalendarCellRac,
  CalendarGridBody as CalendarGridBodyRac,
  CalendarGridHeader as CalendarGridHeaderRac,
  CalendarGrid as CalendarGridRac,
  CalendarHeaderCell as CalendarHeaderCellRac,
  CalendarMonthPicker,
  composeRenderProps,
  RangeCalendar as RangeCalendarRac,
  RangeCalendarStateContext,
  type DateValue,
} from "react-aria-components"

import { cn } from "@/lib/utils/index"

interface BaseCalendarProps {
  className?: string
}

type RangeCalendarProps = ComponentProps<typeof RangeCalendarRac> &
  BaseCalendarProps & {
    /** The years that can be picked, ascending; days in any other year are unavailable. */
    years: number[]
    /** Once a start date is picked, the end can only fall in the start's calendar year. */
    withinStartYear?: boolean
    /** Shown in place of the year select, for dates whose year is not the user's to pick. */
    yearLabel?: string
  }

const PICKER_SELECT =
  "h-8 rounded-md border border-input bg-background px-2 text-sm font-medium outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"

function CalendarHeader({ years, yearLabel }: Readonly<{ years: number[]; yearLabel?: string }>) {
  const range = useContext(RangeCalendarStateContext)
  // The state of the latest render, for the step after a re-render below.
  const latest = useRef(range)
  latest.current = range
  // A start picked so far moves to the new year, so the period stays in one year.
  // While a start is picked the calendar only reaches days near it, so the view
  // follows once it has re-rendered for the moved start.
  const changeYear = (year: number) => {
    if (!range) return
    const anchor = range.anchorDate
    if (!anchor) {
      range.setFocusedDate(range.focusedDate.set({ year }))
      return
    }
    const moved = anchor.set({ year })
    range.setAnchorDate(moved)
    requestAnimationFrame(() => latest.current?.setFocusedDate(moved))
  }
  return (
    // RangeCalendar commits a half-picked range on a pointerup inside it that is
    // not on an enabled button, and when focus leaves it. The header only moves the
    // view, so a press on it must do neither: its pointerup stops here, and outside
    // the selects it keeps the focus where it is. A disabled arrow lets presses
    // through to the header, as the browser sends it no mouse events.
    <header
      className="flex w-full items-center gap-1 pb-1"
      onPointerUp={(e) => e.stopPropagation()}
      onMouseDown={(e) => {
        if (!(e.target as HTMLElement).closest("select")) e.preventDefault()
      }}
    >
      <Button
        slot="previous"
        className="text-muted-foreground/80 hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 flex size-9 items-center justify-center rounded-md transition-[color,box-shadow] outline-none focus-visible:ring-[3px] data-disabled:pointer-events-none data-disabled:opacity-30"
      >
        <ChevronLeftIcon size={16} />
      </Button>
      <div className="flex grow justify-center gap-1">
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
        {yearLabel ? (
          <span className="flex h-8 items-center px-2 text-sm font-medium text-muted-foreground">{yearLabel}</span>
        ) : (
          <select
            aria-label="year"
            value={range?.focusedDate.year ?? years[0]}
            onChange={(e) => changeYear(Number(e.target.value))}
            className={PICKER_SELECT}
          >
            {years.map((year) => (
              <option key={year} value={year}>
                {year}
              </option>
            ))}
          </select>
        )}
      </div>
      <Button
        slot="next"
        className="text-muted-foreground/80 hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 flex size-9 items-center justify-center rounded-md transition-[color,box-shadow] outline-none focus-visible:ring-[3px] data-disabled:pointer-events-none data-disabled:opacity-30"
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

function RangeCalendar({ className, years, withinStartYear = false, yearLabel, isDateUnavailable, ...props }: RangeCalendarProps) {
  // anchor is the start date picked so far, null before one is.
  const unavailable = (date: DateValue, anchor: CalendarDate | null) =>
    (isDateUnavailable?.(date, anchor) ?? false) ||
    !years.includes(date.year) ||
    (withinStartYear && anchor !== null && date.year !== anchor.year)
  return (
    <RangeCalendarRac
      {...props}
      isDateUnavailable={unavailable}
      className={composeRenderProps(className, (className) =>
        cn("w-fit", className)
      )}
    >
      <CalendarHeader years={years} yearLabel={yearLabel} />
      {/* Room for a header row and six weeks, so the popover keeps its height in every month. */}
      <div className="min-h-[calc(2.25rem_+_6*(2.25rem_+_2px))]">
        <CalendarGridComponent isRange />
      </div>
    </RangeCalendarRac>
  )
}

export { RangeCalendar }
