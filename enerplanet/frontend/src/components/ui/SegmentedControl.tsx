import { cn } from "@/lib/utils";

export interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  disabled?: boolean;
  /** Shown on hover, for example why an option is disabled. */
  title?: string;
}

interface SegmentedControlProps<T extends string> {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  "aria-label": string;
  id?: string;
}

/** A row of mutually exclusive options, each one click away; for two or three short choices. */
export function SegmentedControl<T extends string>({ options, value, onChange, id, ...rest }: SegmentedControlProps<T>) {
  return (
    <div id={id} role="radiogroup" aria-label={rest["aria-label"]} className="inline-flex shrink-0 rounded-lg border border-border bg-muted p-0.5">
      {options.map((option) => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="radio"
            aria-checked={selected}
            disabled={option.disabled}
            title={option.title}
            onClick={() => onChange(option.value)}
            className={cn(
              "h-7 whitespace-nowrap rounded-md px-2.5 text-xs font-medium transition-colors",
              selected ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              option.disabled && "cursor-not-allowed opacity-50 hover:text-muted-foreground"
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
