import { ModelStatus, StatusColor } from '@/types/models';

/**
 * Get status color for UI components
 */
export const getStatusColor = (status: ModelStatus): StatusColor => {
	const colorMap: Record<ModelStatus, StatusColor> = {
		draft: "default",
		queue: "info",
		calculating: "primary",
		running: "primary",
		processing: "primary",
		completed: "success", 
		published: "success",
		failed: "error",
		cancelled: "warning",
		modified: "warning",
	};
	return colorMap[status] || "default";
};

/**
 * Get CSS classes for model status styling
 */
export const getModelStatusColor = (status: ModelStatus): string => {
	const colorMap: Record<ModelStatus, string> = {
		completed: "bg-gradient-to-r from-green-100 to-emerald-100 text-green-800 border-green-200 hover:from-green-200 hover:to-emerald-200 shadow-sm",
		published: "bg-gradient-to-r from-purple-100 to-indigo-100 text-purple-800 border-purple-200 hover:from-purple-200 hover:to-indigo-200 shadow-sm",
		queue: "bg-gradient-to-r from-yellow-100 to-amber-100 text-yellow-800 border-yellow-200 hover:from-yellow-200 hover:to-amber-200 shadow-sm animate-pulse",
		calculating: "bg-gradient-to-r from-blue-100 to-cyan-100 text-blue-800 border-blue-200 hover:from-blue-200 hover:to-cyan-200 shadow-sm animate-pulse",
		running: "bg-gradient-to-r from-blue-100 to-cyan-100 text-blue-800 border-blue-200 hover:from-blue-200 hover:to-cyan-200 shadow-sm animate-pulse",
		processing: "bg-gradient-to-r from-blue-100 to-cyan-100 text-blue-800 border-blue-200 hover:from-blue-200 hover:to-cyan-200 shadow-sm animate-pulse",
		failed: "bg-gradient-to-r from-red-100 to-rose-100 text-red-800 border-red-200 hover:from-red-200 hover:to-rose-200 shadow-sm",
		cancelled: "bg-gradient-to-r from-orange-100 to-amber-100 text-orange-800 border-orange-200 hover:from-orange-200 hover:to-amber-200 shadow-sm",
		draft: "bg-gradient-to-r from-gray-100 to-slate-100 text-gray-700 border-gray-200 hover:from-gray-200 hover:to-slate-200 shadow-sm",
		modified: "bg-gradient-to-r from-amber-100 to-yellow-100 text-amber-800 border-amber-200 hover:from-amber-200 hover:to-yellow-200 shadow-sm",
	};
	return colorMap[status] || colorMap.draft;
};

export const isActiveStatus = (status: ModelStatus): boolean => {
	return status === "queue" || status === "running" || status === "calculating" || status === "processing";
};

/**
 * Check if a model is in a processing state and should be disabled
 */
export const isModelDisabled = (status: ModelStatus): boolean => {
	return status === "running" || status === "queue" || status === "calculating" || status === "processing";
};

/**
 * Check if a model has completed successfully
 */
export const isModelCompleted = (status: ModelStatus): boolean => {
	return status === "completed" || status === "published";
};

