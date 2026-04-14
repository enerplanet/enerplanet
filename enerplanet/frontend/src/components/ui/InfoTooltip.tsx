import { useEffect, useRef, useState, useCallback, type CSSProperties, type FC, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { TOOLTIP_CONTENTS, TOOLTIP_KEYS, type TooltipKey } from '@/components/shared/tooltip-contents';
import { useTranslation } from '@spatialhub/i18n';

interface TooltipContent {
	title: string;
	description: string;
	example?: string;
	image?: string;
}

const FIXED_LEFT_ANCHORED = 'fixed-left-anchored';
const FIXED_RIGHT_ANCHORED = 'fixed-right-anchored';
const FIXED_RIGHT = 'fixed-right';
const FIXED_LEFT = 'fixed-left';
const TRANSFORM_CENTER_X = '-translate-x-1/2';
const TRANSFORM_CENTER_Y = '-translate-y-1/2';
const FIXED_POS = 'fixed';
const Z_INDEX_TOOLTIP = 'z-[9999]';
const TOOLTIP_WIDTH_PX = 320;
const TOOLTIP_HEIGHT_ESTIMATE_PX = 220;
const TOOLTIP_MARGIN_PX = 8;
const TOOLTIP_GAP_PX = 10;
const TOOLTIP_MAX_WIDTH_CLASS = 'max-w-[calc(100vw-16px)]';

type TooltipPosition = 'top' | 'bottom' | 'left' | 'right' | typeof FIXED_RIGHT | typeof FIXED_LEFT | typeof FIXED_LEFT_ANCHORED | typeof FIXED_RIGHT_ANCHORED;

interface InfoTooltipProps {
	content: TooltipContent;
	children: ReactNode;
	position?: TooltipPosition;
	className?: string;
}

const InfoTooltip: FC<InfoTooltipProps> = ({
	content,
	children,
	position = 'top',
	className = ''
}) => {
	const [showTooltip, setShowTooltip] = useState(false);
	const triggerRef = useRef<HTMLSpanElement | null>(null);
	const tooltipRef = useRef<HTMLDivElement | null>(null);
	const [anchoredStyle, setAnchoredStyle] = useState<{ top: number; left: number } | null>(null);
	const [floatingStyle, setFloatingStyle] = useState<CSSProperties | null>(null);
	const [resolvedFloatingPosition, setResolvedFloatingPosition] = useState<'top' | 'bottom' | 'left' | 'right'>('top');
	
	const isFixedMode =
		position === FIXED_RIGHT ||
		position === FIXED_LEFT ||
		position === FIXED_LEFT_ANCHORED ||
		position === FIXED_RIGHT_ANCHORED;
	const isAnchored = position === FIXED_LEFT_ANCHORED || position === FIXED_RIGHT_ANCHORED;
	const isPortalFloating =
		position === 'top' ||
		position === 'bottom' ||
		position === 'left' ||
		position === 'right';

	const computeAnchoredPosition = useCallback(() => {
		if (!triggerRef.current) return;
		const rect = triggerRef.current.getBoundingClientRect();
		const tooltipWidth = TOOLTIP_WIDTH_PX;
		const gap = TOOLTIP_GAP_PX;
		const top = rect.top + rect.height / 2;
		let left = 0;
		if (position === FIXED_LEFT_ANCHORED) {
			left = rect.left - tooltipWidth - gap;
		} else {
			left = rect.right + gap;
		}
		setAnchoredStyle({ top, left });
	}, [position]);

	useEffect(() => {
		if (!isAnchored || !showTooltip) return;
		computeAnchoredPosition();
		const onScrollOrResize = () => computeAnchoredPosition();
		window.addEventListener('scroll', onScrollOrResize, true);
		window.addEventListener('resize', onScrollOrResize);
		return () => {
			window.removeEventListener('scroll', onScrollOrResize, true);
			window.removeEventListener('resize', onScrollOrResize);
		};
	}, [isAnchored, showTooltip, position, computeAnchoredPosition]);

	const computeFloatingPosition = useCallback(() => {
		if (!triggerRef.current) return;
		if (!isPortalFloating) return;
		const rect = triggerRef.current.getBoundingClientRect();
		const tooltipRect = tooltipRef.current?.getBoundingClientRect();
		let nextPosition: 'top' | 'bottom' | 'left' | 'right' = position as 'top' | 'bottom' | 'left' | 'right';
		const vw = window.innerWidth;
		const vh = window.innerHeight;
		const tooltipWidth = Math.min(TOOLTIP_WIDTH_PX, Math.max(TOOLTIP_WIDTH_PX / 2, vw - (TOOLTIP_MARGIN_PX * 2)));
		const tooltipHeight = Math.min(
			tooltipRect?.height ?? TOOLTIP_HEIGHT_ESTIMATE_PX,
			Math.max(TOOLTIP_HEIGHT_ESTIMATE_PX / 2, vh - (TOOLTIP_MARGIN_PX * 2))
		);
		const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

		if (nextPosition === 'top' && rect.top < tooltipHeight + TOOLTIP_GAP_PX + TOOLTIP_MARGIN_PX) {
			nextPosition = 'bottom';
		} else if (nextPosition === 'bottom' && (vh - rect.bottom) < tooltipHeight + TOOLTIP_GAP_PX + TOOLTIP_MARGIN_PX) {
			nextPosition = 'top';
		} else if (nextPosition === 'left' && rect.left < tooltipWidth + TOOLTIP_GAP_PX + TOOLTIP_MARGIN_PX) {
			nextPosition = 'right';
		} else if (nextPosition === 'right' && (vw - rect.right) < tooltipWidth + TOOLTIP_GAP_PX + TOOLTIP_MARGIN_PX) {
			nextPosition = 'left';
		}

		let top = 0;
		let left = 0;

		if (nextPosition === 'top') {
			top = rect.top - TOOLTIP_GAP_PX;
			left = rect.left + rect.width / 2;
			const minLeft = TOOLTIP_MARGIN_PX + tooltipWidth / 2;
			const maxLeft = vw - TOOLTIP_MARGIN_PX - tooltipWidth / 2;
			left = clamp(left, minLeft, maxLeft);
		} else if (nextPosition === 'bottom') {
			top = rect.bottom + TOOLTIP_GAP_PX;
			left = rect.left + rect.width / 2;
			const minLeft = TOOLTIP_MARGIN_PX + tooltipWidth / 2;
			const maxLeft = vw - TOOLTIP_MARGIN_PX - tooltipWidth / 2;
			left = clamp(left, minLeft, maxLeft);
		} else if (nextPosition === 'left') {
			top = rect.top + rect.height / 2;
			left = rect.left - TOOLTIP_GAP_PX;
			const minTop = TOOLTIP_MARGIN_PX + tooltipHeight / 2;
			const maxTop = vh - TOOLTIP_MARGIN_PX - tooltipHeight / 2;
			top = clamp(top, minTop, maxTop);
		} else {
			top = rect.top + rect.height / 2;
			left = rect.right + TOOLTIP_GAP_PX;
			const minTop = TOOLTIP_MARGIN_PX + tooltipHeight / 2;
			const maxTop = vh - TOOLTIP_MARGIN_PX - tooltipHeight / 2;
			top = clamp(top, minTop, maxTop);
		}

		setResolvedFloatingPosition(nextPosition);
		setFloatingStyle({ top, left });
	}, [position, isPortalFloating]);

	useEffect(() => {
		if (!isPortalFloating || !showTooltip) return;
		computeFloatingPosition();
		const onScrollOrResize = () => computeFloatingPosition();
		window.addEventListener('scroll', onScrollOrResize, true);
		window.addEventListener('resize', onScrollOrResize);
		return () => {
			window.removeEventListener('scroll', onScrollOrResize, true);
			window.removeEventListener('resize', onScrollOrResize);
		};
	}, [isPortalFloating, showTooltip, computeFloatingPosition]);

	if (!content) {
		return <>{children}</>;
	}

	const getPositionClasses = () => {
		if (isPortalFloating) {
			switch (resolvedFloatingPosition) {
				case 'top':
					return `${FIXED_POS} ${TRANSFORM_CENTER_X} -translate-y-full ${Z_INDEX_TOOLTIP}`;
				case 'bottom':
					return `${FIXED_POS} ${TRANSFORM_CENTER_X} ${Z_INDEX_TOOLTIP}`;
				case 'left':
					return `${FIXED_POS} -translate-x-full ${TRANSFORM_CENTER_Y} ${Z_INDEX_TOOLTIP}`;
				case 'right':
					return `${FIXED_POS} ${TRANSFORM_CENTER_Y} ${Z_INDEX_TOOLTIP}`;
				default:
					return `${FIXED_POS} ${TRANSFORM_CENTER_X} -translate-y-full ${Z_INDEX_TOOLTIP}`;
			}
		}
		switch (position) {
			case FIXED_RIGHT:
				return `${FIXED_POS} right-76 top-1/2 ${TRANSFORM_CENTER_Y} ${Z_INDEX_TOOLTIP}`;
			case FIXED_LEFT:
				return `${FIXED_POS} left-4 top-1/2 ${TRANSFORM_CENTER_Y} ${Z_INDEX_TOOLTIP}`;
			case FIXED_LEFT_ANCHORED:
			case FIXED_RIGHT_ANCHORED:
				return `${FIXED_POS} ${TRANSFORM_CENTER_Y} ${Z_INDEX_TOOLTIP}`;
			default:
				return `bottom-full left-1/2 ${TRANSFORM_CENTER_X} -translate-y-2`;
		}
	};

	const getContainerClasses = () => {
		if (isFixedMode || isPortalFloating) {
			return '';
		}
		return 'relative inline-block';
	};

	const getTooltipClasses = () => {
		if (isFixedMode || isPortalFloating) {
			return `w-80 ${TOOLTIP_MAX_WIDTH_CLASS} bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-2xl p-4 ${getPositionClasses()}`;
		}
		return `absolute z-[100] w-80 ${TOOLTIP_MAX_WIDTH_CLASS} bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-2xl p-4 ${getPositionClasses()}`;
	};

	return (
		<div className={`${getContainerClasses()} ${className}`}>
			<span
				ref={triggerRef}
				role="button"
				tabIndex={0}
				onMouseEnter={() => {
					setShowTooltip(true);
					if (isAnchored) computeAnchoredPosition();
					if (isPortalFloating) computeFloatingPosition();
				}}
				onMouseLeave={() => setShowTooltip(false)}
				onFocus={() => {
					setShowTooltip(true);
					if (isAnchored) computeAnchoredPosition();
					if (isPortalFloating) computeFloatingPosition();
				}}
				onBlur={() => setShowTooltip(false)}
				onClick={(e) => {
					e.stopPropagation();
					setShowTooltip((prev) => !prev);
					if (isAnchored) computeAnchoredPosition();
					if (isPortalFloating) computeFloatingPosition();
				}}
				onKeyDown={(e) => {
					if (e.key === 'Enter' || e.key === ' ') {
						e.preventDefault();
						e.stopPropagation();
						setShowTooltip((prev) => !prev);
						if (isAnchored) computeAnchoredPosition();
						if (isPortalFloating) computeFloatingPosition();
					}
				}}
				aria-label="Show more information"
				className="cursor-pointer bg-transparent border-0 p-0 inline-flex"
			>
				{children}
			</span>

			{showTooltip && (() => {
				const tooltipEl = (
					<div
						ref={tooltipRef}
						className={getTooltipClasses()}
						style={
							isAnchored && anchoredStyle
								? { top: anchoredStyle.top, left: anchoredStyle.left }
								: isPortalFloating && floatingStyle
									? floatingStyle
									: undefined
						}
					>
						<div className="space-y-3">
							<div className="text-sm font-medium text-gray-900 dark:text-gray-100">{content.title}</div>
							<div className="text-xs text-gray-600 dark:text-gray-300 leading-relaxed">{content.description}</div>
							{content.image && (
								<div className="border rounded-lg overflow-hidden">
									<img src={content.image} alt={content.title} className="w-full h-auto" />
								</div>
							)}
							{content.example && (
								<div className="text-xs text-gray-500 dark:text-gray-400">
									<strong>Example:</strong> {content.example}
								</div>
							)}
						</div>
					</div>
				);
				return (isAnchored || isPortalFloating) ? createPortal(tooltipEl, document.body) : tooltipEl;
			})()}
		</div>
	);
};


// Convenience component for info icons
interface InfoIconProps {
	tooltipKey: TooltipKey;
	className?: string;
	position?:
		| 'top'
		| 'bottom'
		| 'left'
		| 'right'
		| 'fixed-right'
		| 'fixed-left'
		| 'fixed-left-anchored'
		| 'fixed-right-anchored';
}

export const InfoIcon: FC<InfoIconProps> = ({ 
	tooltipKey, 
	position = 'top',
	className = ''
}) => {
	const { t } = useTranslation();
	const translationKey = TOOLTIP_KEYS[tooltipKey];
	const fallbackContent = TOOLTIP_CONTENTS[tooltipKey];
	
	// Try to get translated content, fall back to English
	const content = {
		title: t(`${translationKey}.title`, { defaultValue: fallbackContent.title }),
		description: t(`${translationKey}.description`, { defaultValue: fallbackContent.description }),
		example: fallbackContent.example ? t(`${translationKey}.example`, { defaultValue: fallbackContent.example }) : undefined
	};
	
	return (
		<InfoTooltip content={content} position={position} className={className}>
			<svg className="w-4 h-4 text-gray-400 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-200" fill="currentColor" viewBox="0 0 20 20">
				<path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
			</svg>
		</InfoTooltip>
	);
};
