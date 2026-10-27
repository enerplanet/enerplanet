import { useState, type FC } from "react";
import { Keyboard, X } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";
import { Tooltip, TooltipContent, TooltipTrigger } from "@spatialhub/ui";
import { cn } from "@/lib/utils";
import { useMapStore } from "@/features/interactive-map/store/map-store";
import { buildShortcutGroups } from "./shortcutGroups";

/**
 * The map's keyboard and mouse shortcuts in a panel below a button in the map tool
 * column. The panel stays open while the map is used, as a reference during drawing,
 * and closes with the button or its own close button.
 */
export const ShortcutsMenu: FC = () => {
	const { t } = useTranslation();
	const [open, setOpen] = useState(false);
	const isMapLibre3D = useMapStore((s) => s.selectedBaseLayerId === "maplibre_3d");
	const groups = buildShortcutGroups(t, isMapLibre3D);
	const label = t("polygon.shortcuts", "Shortcuts");

	return (
		<div className="relative">
			<Tooltip>
				<TooltipTrigger asChild>
					<button
						type="button"
						onClick={() => setOpen((o) => !o)}
						aria-label={label}
						aria-expanded={open}
						className={cn(
							"flex size-8 cursor-pointer items-center justify-center rounded-full border border-border shadow-sm",
							open ? "bg-primary text-primary-foreground" : "bg-secondary text-secondary-foreground hover:bg-secondary/80"
						)}
					>
						<Keyboard className="h-4 w-4" />
					</button>
				</TooltipTrigger>
				<TooltipContent side="right" sideOffset={8}>
					{label}
				</TooltipContent>
			</Tooltip>
			{open && (
				<div
					role="dialog"
					aria-label={label}
					className="md-fade-in absolute left-0 top-full z-[60] mt-2 w-80 space-y-3 rounded-lg border border-border bg-popover p-3 text-popover-foreground shadow-lg"
				>
					<button
						type="button"
						onClick={() => setOpen(false)}
						aria-label={t("common.close", "Close")}
						className="absolute right-2 top-2 rounded p-0.5 text-muted-foreground hover:text-foreground"
					>
						<X className="h-4 w-4" />
					</button>
					{groups.map((group) => (
						<div key={group.key} className="space-y-1">
							<p className={`text-[10px] font-semibold uppercase tracking-wider ${group.titleClass}`}>{group.title}</p>
							{group.rows.map((row) => (
								<p key={row.action} className={`flex items-baseline gap-1 border-l-2 pl-2 text-xs text-foreground ${group.barClass}`}>
									{row.keys && <kbd className="shrink-0 rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[10px]">{row.keys}</kbd>}
									{row.keys && row.plus && <span className="shrink-0">+</span>}
									<span>{row.action}</span>
								</p>
							))}
						</div>
					))}
				</div>
			)}
		</div>
	);
};
