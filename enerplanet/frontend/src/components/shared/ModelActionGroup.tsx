import React from "react";
import { LucideIcon } from "lucide-react";
import { Button, Tooltip, TooltipTrigger, TooltipContent } from "@spatialhub/ui";
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
	className?: string;
}

interface ModelActionGroupProps {
	actions: ActionConfig[];
	layout?: "horizontal" | "grid";
	size?: ActionSize;
	className?: string;
}

const VARIANT_STYLES: Record<ActionVariant, string> = {
	default: "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-100 dark:hover:bg-gray-700 dark:hover:text-white [&_svg]:text-gray-600 [&_svg]:dark:text-gray-100",
	primary: "text-blue-600 hover:bg-blue-50 hover:text-blue-700 dark:text-blue-400 dark:hover:bg-blue-900/30 dark:hover:text-blue-300 [&_svg]:text-blue-600 [&_svg]:dark:text-blue-400",
	secondary: "text-gray-500 hover:bg-gray-50 hover:text-gray-700 dark:text-gray-200 dark:hover:bg-gray-700 dark:hover:text-white [&_svg]:text-gray-500 [&_svg]:dark:text-gray-200",
	success: "text-green-600 hover:bg-green-50 hover:text-green-700 dark:text-green-400 dark:hover:bg-green-900/30 dark:hover:text-green-300 [&_svg]:text-green-600 [&_svg]:dark:text-green-400",
	warning: "text-yellow-600 hover:bg-yellow-50 hover:text-yellow-700 dark:text-yellow-400 dark:hover:bg-yellow-900/30 dark:hover:text-yellow-300 [&_svg]:text-yellow-600 [&_svg]:dark:text-yellow-400",
	danger: "text-red-600 hover:bg-red-50 hover:text-red-700 dark:text-red-400 dark:hover:bg-red-900/30 dark:hover:text-red-300 [&_svg]:text-red-600 [&_svg]:dark:text-red-400",
	info: "text-cyan-600 hover:bg-cyan-50 hover:text-cyan-700 dark:text-cyan-400 dark:hover:bg-cyan-900/30 dark:hover:text-cyan-300 [&_svg]:text-cyan-600 [&_svg]:dark:text-cyan-400",
	purple: "text-purple-600 hover:bg-purple-50 hover:text-purple-700 dark:text-purple-400 dark:hover:bg-purple-900/30 dark:hover:text-purple-300 [&_svg]:text-purple-600 [&_svg]:dark:text-purple-400",
};

const SIZE_STYLES: Record<ActionSize, string> = {
	small: "h-7 w-7",
	medium: "h-8 w-8",
	large: "h-10 w-10",
};

const ICON_SIZES: Record<ActionSize, string> = {
	small: "h-3.5 w-3.5",
	medium: "h-4 w-4",
	large: "h-5 w-5",
};

const ModelActionGroup: React.FC<ModelActionGroupProps> = ({ actions, layout = "horizontal", size = "small", className = "" }) => {
	// Filter actions that should be shown
	const visibleActions = actions.filter((action) => action.show !== false);

	if (visibleActions.length === 0) {
		return null;
	}

	const containerClasses = [layout === "horizontal" ? "flex items-center gap-1" : "grid grid-cols-2 gap-1", className].filter(Boolean).join(" ");

	return (
		<div className={containerClasses}>
			{visibleActions.map((action) => {
				const variant = action.variant || "default";
				const Icon = action.icon;
				
				const button = (
					<Button
						variant="ghost"
						size="icon"
						disabled={action.disabled}
						onClick={(e) => {
							e.stopPropagation();
							action.onClick();
						}}
						className={cn(
							SIZE_STYLES[size],
							VARIANT_STYLES[variant],
							"transition-colors duration-200",
							action.disabled && "opacity-50 cursor-not-allowed",
							action.className
						)}
					>
						<Icon className={ICON_SIZES[size]} />
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
		</div>
	);
};

export default ModelActionGroup;
