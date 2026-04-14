import React, { useState, useRef, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Check } from 'lucide-react';

interface FilterOption {
	value: string;
	label: string;
	icon?: React.ReactNode;
}

interface FilterDropdownProps {
	options: FilterOption[];
	value: string;
	onChange: (value: string) => void;
	placeholder?: string;
	icon?: React.ReactNode;
	className?: string;
	disabled?: boolean;
}

export const FilterDropdown: React.FC<FilterDropdownProps> = ({
	options,
	value,
	onChange,
	placeholder = 'Select...',
	icon,
	className = '',
	disabled = false,
}) => {
	const [isOpen, setIsOpen] = useState(false);
	const dropdownRef = useRef<HTMLDivElement>(null);
	const dropdownMenuRef = useRef<HTMLDivElement>(null);
	const buttonRef = useRef<HTMLButtonElement>(null);
	const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 180 });

	const updateMenuPosition = useCallback(() => {
		const triggerEl = buttonRef.current || dropdownRef.current;
		if (!triggerEl) return;
		const rect = triggerEl.getBoundingClientRect();
		let top = rect.bottom + 4;
		const width = Math.max(180, rect.width);
		let left = rect.left;
		const maxLeft = Math.max(8, Math.min(left, window.innerWidth - 8 - width));
		left = maxLeft;
		// Use max-h-60 (240px) as the maximum height for the dropdown
		const maxDropdownHeight = 240 + 8; // max-h-60 + padding
		const estimatedHeight = Math.min(options.length * 40 + 16, maxDropdownHeight);
		// Only flip to top if there's not enough space below AND there's more space above
		const spaceBelow = window.innerHeight - rect.bottom - 8;
		const spaceAbove = rect.top - 8;
		if (spaceBelow < estimatedHeight && spaceAbove > spaceBelow) {
			top = Math.max(8, rect.top - 4 - estimatedHeight);
		}
		setMenuPosition({ top, left, width });
	}, [options.length]);

	useEffect(() => {
		const handleClickOutside = (event: MouseEvent) => {
			const target = event.target as Node;
			const clickedInsideTrigger = !!dropdownRef.current && dropdownRef.current.contains(target);
			const clickedInsideMenu = !!dropdownMenuRef.current && dropdownMenuRef.current.contains(target);
			if (!clickedInsideTrigger && !clickedInsideMenu) {
				setIsOpen(false);
			}
		};

		const handleScrollResize = () => {
			if (isOpen) updateMenuPosition();
		};

		if (isOpen) {
			updateMenuPosition();
			document.addEventListener('mousedown', handleClickOutside);
			window.addEventListener('scroll', handleScrollResize, true);
			window.addEventListener('resize', handleScrollResize);
		}

		return () => {
			document.removeEventListener('mousedown', handleClickOutside);
			window.removeEventListener('scroll', handleScrollResize, true);
			window.removeEventListener('resize', handleScrollResize);
		};
	}, [isOpen, updateMenuPosition]);

	const selectedOption = options.find(opt => opt.value === value);
	const displayLabel = selectedOption?.label || placeholder;

	const handleSelect = (optionValue: string) => {
		onChange(optionValue);
		setIsOpen(false);
	};

	return (
		<div className={`relative ${className}`} ref={dropdownRef}>
			<button
				type="button"
				ref={buttonRef}
				onClick={() => !disabled && setIsOpen(prev => !prev)}
				className={`flex items-center gap-2 h-10 px-3 border border-border rounded-lg hover:bg-muted/50 transition-all duration-200 bg-card text-sm disabled:opacity-50 disabled:cursor-not-allowed min-w-[140px] justify-between shadow-sm`}
				disabled={disabled}
			>
				<div className="flex items-center gap-2 min-w-0">
					{icon && (
						<div className="w-6 h-6 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
							{icon}
						</div>
					)}
					<span className={`text-foreground truncate ${value ? 'font-medium' : ''}`}>
						{displayLabel}
					</span>
				</div>
				<ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
			</button>

			{isOpen && createPortal(
				<div
					ref={dropdownMenuRef}
					role="menu"
					tabIndex={-1}
					className="fixed bg-card border border-border rounded-xl shadow-xl z-[9999] overflow-hidden pointer-events-auto"
					style={{ top: menuPosition.top, left: menuPosition.left, width: menuPosition.width }}
					onWheel={(e) => e.stopPropagation()}
					onMouseDown={(e) => e.stopPropagation()}
					onKeyDown={(e) => {
						if (e.key === 'Escape') {
							setIsOpen(false);
						}
					}}
				>
					<div className="max-h-60 overflow-y-auto py-1">
						{options.map((option) => (
							<button
								key={option.value}
								type="button"
								onClick={() => handleSelect(option.value)}
								className={`w-full flex items-center gap-3 px-3 py-2.5 hover:bg-muted/50 transition-colors text-left ${
									value === option.value ? 'bg-muted/50' : ''
								}`}
							>
								{option.icon && (
									<div className="w-6 h-6 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
										{option.icon}
									</div>
								)}
								<span className={`flex-1 text-sm ${value === option.value ? 'font-semibold text-foreground' : 'text-muted-foreground'}`}>
									{option.label}
								</span>
								{value === option.value && (
									<Check className="w-4 h-4 text-primary flex-shrink-0" />
								)}
							</button>
						))}
					</div>
				</div>,
				document.body
			)}
		</div>
	);
};
