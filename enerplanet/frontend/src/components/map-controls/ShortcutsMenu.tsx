import type { FC } from "react";
import { Keyboard } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger, Tooltip, TooltipContent, TooltipTrigger } from "@spatialhub/ui";
import { useMapStore } from "@/features/interactive-map/store/map-store";
import { buildShortcutGroups } from "./PolygonDrawingGuide";

/** The map's keyboard and mouse shortcuts behind a button in the map tool column. */
export const ShortcutsMenu: FC = () => {
	const { t } = useTranslation();
	const isMapLibre3D = useMapStore((s) => s.selectedBaseLayerId === "maplibre_3d");
	const groups = buildShortcutGroups(t, isMapLibre3D);

	return (
		<Tooltip>
			<DropdownMenu>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						<button
							type="button"
							aria-label={t("polygon.shortcuts", "Shortcuts")}
							className="flex size-8 cursor-pointer items-center justify-center rounded-full border border-border bg-secondary text-secondary-foreground shadow-sm hover:bg-secondary/80"
						>
							<Keyboard className="h-4 w-4" />
						</button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent side="right" sideOffset={8}>
					{t("polygon.shortcuts", "Shortcuts")}
				</TooltipContent>
				<DropdownMenuContent side="right" align="start" sideOffset={8} className="z-[60] w-80 space-y-3 p-3">
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
				</DropdownMenuContent>
			</DropdownMenu>
		</Tooltip>
	);
};
