"use client"

import { ComponentProps, useState } from "react"
import { getLocalTimeZone, today, CalendarDate } from "@internationalized/date"
import { ChevronLeftIcon, ChevronRightIcon, ChevronDown } from "lucide-react"
import {
  Button,
  CalendarCell as CalendarCellRac,
  CalendarGridBody as CalendarGridBodyRac,
  CalendarGridHeader as CalendarGridHeaderRac,
  CalendarGrid as CalendarGridRac,
  CalendarHeaderCell as CalendarHeaderCellRac,
  composeRenderProps,
  Heading as HeadingRac,
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

function CalendarHeader({ minYear = 1980, maxYear = 2025, onYearChange }: Readonly<{ minYear?: number; maxYear?: number; onYearChange?: (year: number) => void }>) {
  const [showYearPicker, setShowYearPicker] = useState(false)
  const years = Array.from({ length: maxYear - minYear + 1 }, (_, i) => maxYear - i)

  return (
    <header className="flex w-full items-center gap-1 pb-1 relative">
      <Button
        slot="previous"
        className="text-muted-foreground/80 hover:bg-accent hover:text-foreground focus-visible:ring-ring/50 flex size-9 items-center justify-center rounded-md transition-[color,box-shadow] outline-none focus-visible:ring-[3px]"
      >
        <ChevronLeftIcon size={16} />
      </Button>
      <div className="grow text-center relative">
        <button
          type="button"
          onClick={() => setShowYearPicker(!showYearPicker)}
          className="inline-flex items-center gap-1 text-sm font-medium hover:bg-accent px-2 py-1 rounded-md transition-colors"
        >
          <HeadingRac className="pointer-events-none" />
          <ChevronDown size={14} className={cn("text-muted-foreground transition-transform", showYearPicker && "rotate-180")} />
        </button>
        {showYearPicker && (
          <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 z-50 bg-popover border border-border rounded-md shadow-lg max-h-48 overflow-y-auto w-24">
            {years.map((year) => (
              <button
                key={year}
                type="button"
                onClick={() => {
                  onYearChange?.(year)
                  setShowYearPicker(false)
                }}
                className="w-full px-3 py-1.5 text-sm text-left hover:bg-accent transition-colors"
              >
                {year}
              </button>
            ))}
          </div>
        )}
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
  const [focusedDate, setFocusedDate] = useState<CalendarDate | undefined>(undefined)
  
  const handleYearChange = (year: number) => {
    const currentDate = focusedDate || today(getLocalTimeZone())
    setFocusedDate(new CalendarDate(year, currentDate.month, 1))
  }

  return (
    <RangeCalendarRac
      {...props}
      focusedValue={focusedDate}
      onFocusChange={setFocusedDate}
      className={composeRenderProps(className, (className) =>
        cn("w-fit", className)
      )}
    >
      <CalendarHeader minYear={minYear} maxYear={maxYear} onYearChange={handleYearChange} />
      <CalendarGridComponent isRange />
    </RangeCalendarRac>
  )
}

export { RangeCalendar }
