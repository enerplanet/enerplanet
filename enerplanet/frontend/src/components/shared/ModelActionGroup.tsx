import React, { useState } from "react";
import { createPortal } from "react-dom";
import { Loader2, LucideIcon, MoreHorizontal } from "lucide-react";
import { Button, Tooltip, TooltipTrigger, TooltipContent, DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@spatialhub/ui";
import { useTranslation } from "@spatialhub/i18n";
import { cn } from "@/lib/utils";

type ActionVariant = 'default' | 'primary' | 'secondary' | 'success' | 'warning' | 'danger' | 'info' | 'purple';
export type ActionSize = 'small' | 'medium' | 'large';

export interface ActionConfig {
	key: string;
	icon: LucideIcon;
	tooltip: string;
	variant?: ActionVariant;
	onClick: () => void;
	show?: boolean;
	disabled?: boolean;
	/** Swap the icon for a spinner and block clicks: the action is in flight. */
	loading?: boolean;
	/** List the action in the "more actions" menu instead of as an icon. */
	menu?: boolean;
	className?: string;
}

interface ModelActionGroupProps {
	actions: ActionConfig[];
	layout?: "horizontal" | "grid";
	size?: ActionSize;
	className?: string;
}

const VARIANT_STYLES: Record<ActionVariant, string> = {
	default: "text-gray-600 hover:bg-gray-200 hover:ring-1 hover:ring-gray-300 hover:text-gray-900 dark:text-gray-100 dark:hover:bg-gray-700 dark:hover:ring-gray-500 dark:hover:text-white [&_svg]:text-gray-600 [&_svg]:dark:text-gray-100",
	primary: "text-blue-600 hover:bg-blue-100 hover:ring-1 hover:ring-blue-300 hover:text-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/50 dark:hover:ring-blue-700 dark:hover:text-blue-300 [&_svg]:text-blue-600 [&_svg]:dark:text-blue-400",
	secondary: "text-gray-500 hover:bg-gray-200 hover:ring-1 hover:ring-gray-300 hover:text-gray-700 dark:text-gray-200 dark:hover:bg-gray-700 dark:hover:ring-gray-500 dark:hover:text-white [&_svg]:text-gray-500 [&_svg]:dark:text-gray-200",
	success: "text-green-600 hover:bg-green-100 hover:ring-1 hover:ring-green-300 hover:text-green-700 dark:text-green-400 dark:hover:bg-green-900/50 dark:hover:ring-green-700 dark:hover:text-green-300 [&_svg]:text-green-600 [&_svg]:dark:text-green-400",
	warning: "text-yellow-600 hover:bg-yellow-100 hover:ring-1 hover:ring-yellow-300 hover:text-yellow-700 dark:text-yellow-400 dark:hover:bg-yellow-900/50 dark:hover:ring-yellow-700 dark:hover:text-yellow-300 [&_svg]:text-yellow-600 [&_svg]:dark:text-yellow-400",
	danger: "text-red-600 hover:bg-red-100 hover:ring-1 hover:ring-red-300 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/50 dark:hover:ring-red-700 dark:hover:text-red-300 [&_svg]:text-red-600 [&_svg]:dark:text-red-400",
	info: "text-cyan-600 hover:bg-cyan-100 hover:ring-1 hover:ring-cyan-300 hover:text-cyan-700 dark:text-cyan-400 dark:hover:bg-cyan-900/50 dark:hover:ring-cyan-700 dark:hover:text-cyan-300 [&_svg]:text-cyan-600 [&_svg]:dark:text-cyan-400",
	purple: "text-purple-600 hover:bg-purple-100 hover:ring-1 hover:ring-purple-300 hover:text-purple-700 dark:text-purple-400 dark:hover:bg-purple-900/50 dark:hover:ring-purple-700 dark:hover:text-purple-300 [&_svg]:text-purple-600 [&_svg]:dark:text-purple-400",
};

const SIZE_STYLES: Record<ActionSize, string> = {
	small: "h-7 w-7",
	medium: "h-8 w-8",
	large: "h-10 w-10",
};

const ICON_SIZES: Record<ActionSize, string> = {
	small: "h-3.5 w-3.5",
	medium: "h-4 w-4",
	large: "h-[22px] w-[22px]",
};

/** The "more actions" button and the menu of the actions it holds. */
const MoreActionsMenu: React.FC<{ actions: ActionConfig[]; size: ActionSize }> = ({ actions, size }) => {
	const { t } = useTranslation();
	const label = t("common.modelActions.moreActions");
	const [open, setOpen] = useState(false);
	return (
		<DropdownMenu onOpenChange={setOpen}>
			{/* Dims the page while the menu is open, as the rail menus do (AppLayout). Portalled to
			    the body so an animated table row cannot become its containing block. */}
			{open &&
				createPortal(
					<div
						aria-hidden="true"
						className="pointer-events-none fixed inset-0 z-[51] bg-black/20 animate-in fade-in duration-200 motion-reduce:animate-none dark:bg-black/40"
					/>,
					document.body
				)}
			<Tooltip>
				<TooltipTrigger asChild>
					<DropdownMenuTrigger asChild>
						{/* A plain button: the menu anchors to the trigger's ref, which the UI library's Button drops. */}
						<button
							type="button"
							aria-label={label}
							onClick={(e) => e.stopPropagation()}
							className={cn("inline-flex items-center justify-center rounded-md", SIZE_STYLES[size], VARIANT_STYLES.secondary, "transition-colors duration-200")}
						>
							<MoreHorizontal className={ICON_SIZES[size]} />
						</button>
					</DropdownMenuTrigger>
				</TooltipTrigger>
				<TooltipContent>
					<p>{label}</p>
				</TooltipContent>
			</Tooltip>
			<DropdownMenuContent align="end" className="z-[52] max-w-72 rounded-xl border-border bg-card shadow-xl">
				{actions.map((action) => {
					const Icon = action.icon;
					return (
						<DropdownMenuItem
							key={action.key}
							disabled={action.disabled || action.loading}
							onClick={(e) => {
								e.stopPropagation();
								action.onClick();
							}}
							className={cn("cursor-pointer", action.variant === "danger" && "text-red-700 focus:text-red-700 dark:text-red-400")}
						>
							<Icon className="h-4 w-4" />
							{action.tooltip}
						</DropdownMenuItem>
					);
				})}
			</DropdownMenuContent>
		</DropdownMenu>
	);
};

const ModelActionGroup: React.FC<ModelActionGroupProps> = ({ actions, layout = "horizontal", size = "small", className = "" }) => {
	const visibleActions = actions.filter((action) => action.show !== false);
	const inlineActions = visibleActions.filter((action) => !action.menu);
	const menuActions = visibleActions.filter((action) => action.menu);

	if (visibleActions.length === 0) {
		return null;
	}

	const containerClasses = [layout === "horizontal" ? "flex items-center gap-1" : "grid grid-cols-2 gap-1", className].filter(Boolean).join(" ");

	return (
		<div className={containerClasses}>
			{inlineActions.map((action) => {
				const variant = action.variant || "default";
				const Icon = action.icon;
				const busy = action.loading === true;

				const button = (
					<Button
						variant="ghost"
						size="icon"
						aria-label={action.tooltip}
						aria-busy={busy || undefined}
						disabled={action.disabled || busy}
						onClick={(e) => {
							e.stopPropagation();
							action.onClick();
						}}
						className={cn(
							SIZE_STYLES[size],
							VARIANT_STYLES[variant],
							"transition-colors duration-200",
							(action.disabled || busy) && "opacity-50 cursor-not-allowed",
							action.className
						)}
					>
						{busy
							? <Loader2 className={cn(ICON_SIZES[size], "animate-spin")} />
							: <Icon className={ICON_SIZES[size]} />}
					</Button>
				);
				
				return (
					<Tooltip key={action.key}>
						<TooltipTrigger asChild>
							{/* Wrap in span to allow tooltip on disabled buttons */}
							<span className="inline-flex">
								{button}
							</span>
						</TooltipTrigger>
						<TooltipContent>
							<p>{action.tooltip}</p>
						</TooltipContent>
					</Tooltip>
				);
			})}
			{menuActions.length > 0 && <MoreActionsMenu actions={menuActions} size={size} />}
		</div>
	);
};

export default ModelActionGroup;
