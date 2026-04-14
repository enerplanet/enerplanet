// Consolidated status type used across fire models and other model types
export type ModelStatus = 
	| 'draft' 
	| 'queue' 
	| 'calculating' 
	| 'running' 
	| 'processing'
	| 'completed' 
	| 'published' 
	| 'failed' 
	| 'cancelled'
	| 'modified';

export type StatusColor = "default" | "primary" | "secondary" | "error" | "info" | "success" | "warning";

export type ChipVariant = "filled" | "outlined" | "gradient";

export type ChipSize = "small" | "medium";

export type IconSize = "small" | "medium";
