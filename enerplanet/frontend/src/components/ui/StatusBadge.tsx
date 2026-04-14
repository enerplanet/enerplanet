import React from 'react';
import { RefreshCw } from 'lucide-react';
import { ModelStatus, ChipVariant, ChipSize } from '@/types/models';
import { getStatusColor, isActiveStatus } from '@/features/model-dashboard/utils/statusHelpers';
import { getChipClasses, ChipColor } from './chip-styles';
import StatusIcon from './StatusIcon';
import { useTranslation } from '@spatialhub/i18n';

interface StatusBadgeProps {
	status?: ModelStatus;
	icon?: React.ReactNode;
	text?: string; // For generic usage
	label?: string; // Alternative to text
	variant?: ChipVariant | "default" | "success" | "warning" | "danger" | "info";
	size?: ChipSize;
	showIcon?: boolean;
	showSpinner?: boolean;
	className?: string;
	onClick?: () => void;
}

// Map legacy variants to colors
const variantColorMap: Record<string, ChipColor> = {
	success: "success",
	warning: "warning",
	danger: "error",
	info: "info",
	default: "default",
};

const styleVariants = new Set(["filled", "outlined", "gradient"]);

function determineChipColorAndVariant(
	status: ModelStatus | undefined,
	variant: string
): { chipColor: ChipColor; chipVariant: ChipVariant } {
	if (status) {
		const chipVariant = styleVariants.has(variant) ? (variant as ChipVariant) : "filled";
		return { chipColor: getStatusColor(status), chipVariant };
	}
	
	if (variantColorMap[variant]) {
		return { chipColor: variantColorMap[variant], chipVariant: "filled" };
	}
	
	if (styleVariants.has(variant)) {
		return { chipColor: "default", chipVariant: variant as ChipVariant };
	}
	
	return { chipColor: "default", chipVariant: "filled" };
}

const StatusBadge: React.FC<StatusBadgeProps> = ({ 
	status,
	icon,
	text,
	label: labelProp,
	variant = "filled", 
	size = "medium", 
	showIcon = true, 
	showSpinner = true,
	className = "",
	onClick 
}) => {
	const { t } = useTranslation();
	const { chipColor, chipVariant } = determineChipColorAndVariant(status, variant);
	
	const getTranslatedStatusLabel = (s: ModelStatus): string => {
		return t(`modelStatus.${s}`);
	};
	
	const displayLabel = status ? getTranslatedStatusLabel(status) : (text || labelProp || "");
	const shouldShowSpinner = status && showSpinner && isActiveStatus(status);
	const displayIcon = status && showIcon && !shouldShowSpinner 
		? <StatusIcon status={status} size={size} /> 
		: icon;
	
	const badgeClassName = getChipClasses(chipColor, chipVariant, size, !!onClick, className);

	const content = (
		<>
			{shouldShowSpinner && (
				<RefreshCw className="w-3 h-3 animate-spin text-gray-600 dark:text-gray-300 mr-1" />
			)}
			{displayIcon && !shouldShowSpinner && (
				<span className="mr-1 flex items-center">{displayIcon}</span>
			)}
			{displayLabel}
		</>
	);

	if (onClick) {
		return (
			<button
				type="button"
				onClick={onClick}
				aria-label={displayLabel}
				className={badgeClassName}
			>
				{content}
			</button>
		);
	}

	return (
		<span className={badgeClassName}>
			{content}
		</span>
	);
};

export default StatusBadge;
