import React from 'react';
import { ChipColor, ChipVariant, ChipSize, getChipClasses } from './chip-styles';

interface ChipProps {
	label: string;
	color: ChipColor;
	variant?: ChipVariant;
	onClick?: () => void;
	size?: ChipSize;
	className?: string;
}

/**
 * Chip component for displaying labels with various styles and colors
 */
const Chip: React.FC<ChipProps> = ({ 
	label, 
	color, 
	variant = "filled", 
	onClick, 
	size = "medium",
	className = ""
}) => {
	const chipClassName = getChipClasses(color, variant, size, !!onClick, className);

	if (onClick) {
		return (
			<button
				type="button"
				onClick={onClick}
				aria-label={label}
				className={chipClassName}
			>
				{label}
			</button>
		);
	}

	return (
		<span className={chipClassName}>
			{label}
		</span>
	);
};

export default Chip;
