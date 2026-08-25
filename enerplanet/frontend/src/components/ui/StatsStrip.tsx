export interface StatsStripItem {
	label: string;
	value: string | number;
	/** Renders the value in the destructive colour (limits reached, errors, …). */
	highlight?: boolean;
}

interface StatsStripProps {
	items: StatsStripItem[];
	className?: string;
}

// Compact inline stats strip (label + value pairs) shown in a page toolbar.
export function StatsStrip({ items, className = "" }: StatsStripProps) {
	return (
		<div className={`flex flex-wrap items-center gap-2 ${className}`}>
			{items.map((item) => (
				<div
					key={item.label}
					className="flex h-9 items-center gap-2 rounded-lg border border-border bg-muted/30 px-3"
				>
					<span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
						{item.label}
					</span>
					<span
						className={`text-sm font-semibold tabular-nums leading-none ${
							item.highlight ? "text-destructive" : "text-foreground"
						}`}
					>
						{item.value}
					</span>
				</div>
			))}
		</div>
	);
}

export default StatsStrip;
