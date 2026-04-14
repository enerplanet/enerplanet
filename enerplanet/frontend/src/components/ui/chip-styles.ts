/**
 * Shared chip/badge styling utilities
 */

export type ChipColor = "default" | "primary" | "secondary" | "error" | "info" | "success" | "warning";
export type ChipVariant = "filled" | "outlined" | "gradient";
export type ChipSize = "small" | "medium";

const CHIP_COLOR_CLASSES: Record<ChipColor, Record<ChipVariant, string>> = {
	default: {
		filled: "bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200",
		outlined: "border-2 border-slate-300 text-slate-700 bg-white hover:bg-slate-50",
		gradient: "bg-gradient-to-r from-slate-100 to-slate-200 text-slate-700 border border-slate-300"
	},
	primary: {
		filled: "bg-blue-100 text-blue-800 border border-blue-200 hover:bg-blue-200",
		outlined: "border-2 border-blue-400 text-blue-700 bg-white hover:bg-blue-50",
		gradient: "bg-gradient-to-r from-blue-400 to-blue-500 text-white shadow-md hover:shadow-lg"
	},
	secondary: {
		filled: "bg-amber-100 text-amber-800 border border-amber-200 hover:bg-amber-200",
		outlined: "border-2 border-amber-400 text-amber-700 bg-white hover:bg-amber-50",
		gradient: "bg-gradient-to-r from-amber-400 to-orange-400 text-white shadow-md hover:shadow-lg"
	},
	error: {
		filled: "bg-red-100 text-red-800 border border-red-200 hover:bg-red-200",
		outlined: "border-2 border-red-400 text-red-700 bg-white hover:bg-red-50",
		gradient: "bg-gradient-to-r from-red-400 to-red-500 text-white shadow-md hover:shadow-lg"
	},
	info: {
		filled: "bg-cyan-100 text-cyan-800 border border-cyan-200 hover:bg-cyan-200",
		outlined: "border-2 border-cyan-400 text-cyan-700 bg-white hover:bg-cyan-50",
		gradient: "bg-gradient-to-r from-cyan-400 to-blue-400 text-white shadow-md hover:shadow-lg"
	},
	success: {
		filled: "bg-emerald-100 text-emerald-800 border border-emerald-200 hover:bg-emerald-200",
		outlined: "border-2 border-emerald-400 text-emerald-700 bg-white hover:bg-emerald-50",
		gradient: "bg-gradient-to-r from-emerald-400 to-green-500 text-white shadow-md hover:shadow-lg"
	},
	warning: {
		filled: "bg-yellow-100 text-yellow-800 border border-yellow-200 hover:bg-yellow-200",
		outlined: "border-2 border-yellow-400 text-yellow-700 bg-white hover:bg-yellow-50",
		gradient: "bg-gradient-to-r from-yellow-400 to-orange-400 text-white shadow-md hover:shadow-lg"
	},
};

export const getChipClasses = (
	color: ChipColor,
	variant: ChipVariant,
	size: ChipSize,
	hasClick: boolean,
	customClass?: string
): string => {
	const baseClasses = "inline-flex items-center font-medium rounded-full transition-all duration-200 shadow-sm";
	const sizeClasses = size === "small" 
		? "px-2.5 py-1 text-xs font-semibold" 
		: "px-3 py-1.5 text-sm font-semibold";
	const hoverClasses = hasClick ? "cursor-pointer hover:scale-105 active:scale-95" : "";
	
	return `${baseClasses} ${sizeClasses} ${CHIP_COLOR_CLASSES[color][variant]} ${hoverClasses} ${customClass || ''}`;
};
