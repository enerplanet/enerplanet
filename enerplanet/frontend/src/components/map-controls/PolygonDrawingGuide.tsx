import { useState, useEffect, type FC } from "react";
import { X, MousePointer2, CircleDot, Check } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";

/** One gesture in the Shortcuts card: optional key, optional "+", and what it does. */
type ShortcutRow = { keys?: string; plus?: boolean; action: string };

/** Shortcut groups by what a gesture does: green draws, red deletes, blue moves the view. */
export const buildShortcutGroups = (
	t: (key: string, fallback: string) => string,
	isMapLibre3D: boolean,
): { key: string; title: string; titleClass: string; barClass: string; rows: ShortcutRow[] }[] => {
	return [
		{
			key: 'drawing',
			title: t('polygon.groupDrawing', 'Drawing'),
			titleClass: 'text-emerald-600 dark:text-emerald-400',
			barClass: 'border-emerald-500',
			rows: [
				{ action: t('polygon.moveVertex', 'Drag a corner to move it') },
				{ action: t('polygon.addVertex', 'Drag an edge to add a corner') },
				{ keys: t('polygon.keyRightClick', 'Right-click'), action: t('polygon.rightClickCloseHint', 'to close the polygon') },
				{ keys: 'Esc', action: t('polygon.escToCancel', 'to cancel drawing') },
			],
		},
		{
			key: 'deleting',
			title: t('polygon.groupDeleting', 'Deleting'),
			titleClass: 'text-red-600 dark:text-red-400',
			barClass: 'border-red-500',
			rows: [
				{ keys: 'Alt', plus: true, action: t('polygon.removeVertexHint', 'click on a corner to delete it') },
				{ keys: 'Shift', plus: true, action: t('polygon.removePolygonHint', 'click on polygon to delete it') },
			],
		},
		// Building gestures are handled on the 2D map only.
		...(isMapLibre3D ? [] : [{
			key: 'buildings',
			title: t('polygon.groupBuildings', 'Buildings'),
			titleClass: 'text-amber-600 dark:text-amber-400',
			barClass: 'border-amber-500',
			rows: [
				{ keys: 'Alt', plus: true, action: t('polygon.disableBuildingHint', 'click a building to disable or enable it') },
				{ keys: t('polygon.keyCtrl', 'Ctrl'), plus: true, action: t('polygon.selectBuildingHint', 'click buildings to select them') },
				{ keys: t('polygon.keyDelete', 'Delete'), action: t('polygon.disableSelectedHint', 'disables the selected buildings') },
			],
		}]),
		{
			key: 'navigating',
			title: t('polygon.groupNavigating', 'Navigating'),
			titleClass: 'text-blue-600 dark:text-blue-400',
			barClass: 'border-blue-500',
			rows: [
				{ keys: t('polygon.keySpace', 'Space'), plus: true, action: t('polygon.spacePanHint', 'drag to pan the map') },
				...(isMapLibre3D ? [{ keys: t('polygon.keyRightClick', 'Right-click'), plus: true, action: t('polygon.rotate3dDrag', 'drag to rotate the 3D view') }] : []),
			],
		},
	];
};

interface PolygonDrawingGuideProps {
	/** Whether polygon drawing is available (no polygon exists yet or multiple allowed) */
	canDraw: boolean;
	/** Whether user is currently drawing */
	isDrawing: boolean;
	/** Number of existing polygons */
	polygonCount: number;
	/** Number of points in current drawing */
	currentPointCount?: number;
}

export const PolygonDrawingGuide: FC<PolygonDrawingGuideProps> = ({
	canDraw,
	isDrawing,
	polygonCount,
	currentPointCount = 0,
}) => {
	const { t } = useTranslation();
	const [isDrawGuideVisible, setIsDrawGuideVisible] = useState(true);
	const [isDrawGuideDismissed, setIsDrawGuideDismissed] = useState(false);

	// Determine current step based on drawing state
	const currentStep = !isDrawing ? 1 : currentPointCount >= 3 ? 3 : currentPointCount >= 1 ? 2 : 1;

	// Show draw guide until polygon is finished or dismissed
	useEffect(() => {
		if (polygonCount > 0 || isDrawGuideDismissed) {
			setIsDrawGuideVisible(false);
		} else if (canDraw && polygonCount === 0 && !isDrawGuideDismissed) {
			setIsDrawGuideVisible(true);
		}
	}, [canDraw, polygonCount, isDrawGuideDismissed]);

	const handleDismissDrawGuide = () => {
		setIsDrawGuideDismissed(true);
		setIsDrawGuideVisible(false);
	};

	if (!isDrawGuideVisible) return null;

	const getStepStyle = (step: number) => {
		if (step < currentStep) {
			// Completed step
			return {
				circle: "bg-foreground border-foreground",
				number: "text-background",
				showCheck: true,
			};
		} else if (step === currentStep) {
			// Current step
			return {
				circle: "bg-foreground/10 border-foreground animate-pulse",
				number: "text-foreground",
				showCheck: false,
			};
		} else {
			// Future step
			return {
				circle: "bg-muted border-muted-foreground/30",
				number: "text-muted-foreground",
				showCheck: false,
			};
		}
	};

	return (
		<div
			className="absolute z-40 animate-in slide-in-from-right-2 fade-in duration-300"
			style={{
				top: "calc(4rem + 8rem)",
				right: "calc(1rem + var(--sidebar-offset, 0rem))"
			}}
		>
			<div className="relative w-64 bg-card border border-border rounded-lg shadow-xl overflow-hidden">
				{/* Close button */}
				<button
					onClick={handleDismissDrawGuide}
					className="absolute top-2 right-2 p-1 rounded-full hover:bg-muted/80 transition-colors text-muted-foreground hover:text-foreground"
					aria-label={t('polygon.dismissGuide')}
				>
					<X className="w-3.5 h-3.5" />
				</button>

				{/* Content */}
				<div className="p-4 pt-4">
					<h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
						<MousePointer2 className="w-4 h-4 text-primary" />
						{t('polygon.drawRegion')}
					</h4>

					<div className="space-y-3">
						{/* Step 1 */}
						{(() => {
							const style = getStepStyle(1);
							return (
								<div className="flex gap-3">
									<div className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${style.circle}`}>
										{style.showCheck ? (
											<Check className="w-3.5 h-3.5 text-background" />
										) : (
											<span className={`text-xs font-bold ${style.number}`}>1</span>
										)}
									</div>
									<div className="flex-1 pt-0.5">
										<p className={`text-xs font-medium ${currentStep === 1 ? 'text-foreground' : 'text-muted-foreground'}`}>{t('polygon.clickToStart')}</p>
										<p className="text-[10px] text-muted-foreground mt-0.5">
											{t('polygon.clickAnywhere')}
										</p>
									</div>
								</div>
							);
						})()}

						{/* Step 2 */}
						{(() => {
							const style = getStepStyle(2);
							return (
								<div className="flex gap-3">
									<div className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${style.circle}`}>
										{style.showCheck ? (
											<Check className="w-3.5 h-3.5 text-background" />
										) : (
											<span className={`text-xs font-bold ${style.number}`}>2</span>
										)}
									</div>
									<div className="flex-1 pt-0.5">
										<p className={`text-xs font-medium ${currentStep === 2 ? 'text-foreground' : 'text-muted-foreground'}`}>
											{t('polygon.addMorePoints')}
											{currentStep === 2 && currentPointCount > 0 && (
												<span className="ml-1.5 text-[10px] text-foreground/70">({t('polygon.pointsAdded', { count: currentPointCount })})</span>
											)}
										</p>
										<p className="text-[10px] text-muted-foreground mt-0.5">
											{t('polygon.continueClicking')}
										</p>
									</div>
								</div>
							);
						})()}

						{/* Step 3 */}
						{(() => {
							const style = getStepStyle(3);
							return (
								<div className="flex gap-3">
									<div className={`flex-shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-all duration-300 ${style.circle}`}>
										{style.showCheck ? (
											<Check className="w-3.5 h-3.5 text-background" />
										) : (
											<span className={`text-xs font-bold ${style.number}`}>3</span>
										)}
									</div>
									<div className="flex-1 pt-0.5">
										<p className={`text-xs font-medium flex items-center gap-1.5 ${currentStep === 3 ? 'text-foreground' : 'text-muted-foreground'}`}>
											{t('polygon.closePolygon')}
											<CircleDot className="w-3 h-3 text-cyan-500" />
										</p>
										<p className="text-[10px] text-muted-foreground mt-0.5">
											{t('polygon.doubleClickOrClick')}
										</p>
									</div>
								</div>
							);
						})()}
					</div>

					{/* Visual hint with larger polygon */}
					<div className="mt-4 p-3 bg-muted/50 rounded-md border border-border/50">
						<div className="flex flex-col items-center gap-2">
							{/* Larger polygon illustration */}
							<svg width="120" height="80" viewBox="0 0 120 80" className="text-foreground">
								{/* Polygon shape */}
								<path
									d="M20 60 L50 15 L100 25 L90 65 L35 70 Z"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeDasharray="6 4"
									className="opacity-50"
								/>
								{/* Connection line to close */}
								<path
									d="M35 70 L20 60"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									strokeDasharray="6 4"
									className="opacity-50"
								/>
								{/* Points with numbers */}
								<circle cx="20" cy="60" r="8" className="fill-cyan-500" />
								<text x="20" y="64" textAnchor="middle" className="fill-white text-[10px] font-bold">1</text>

								<circle cx="50" cy="15" r="5" className="fill-foreground opacity-60" />
								<text x="50" y="18" textAnchor="middle" className="fill-background text-[8px] font-medium">2</text>

								<circle cx="100" cy="25" r="5" className="fill-foreground opacity-60" />
								<text x="100" y="28" textAnchor="middle" className="fill-background text-[8px] font-medium">3</text>

								<circle cx="90" cy="65" r="5" className="fill-foreground opacity-60" />
								<text x="90" y="68" textAnchor="middle" className="fill-background text-[8px] font-medium">4</text>

								<circle cx="35" cy="70" r="5" className="fill-foreground opacity-60" />
								<text x="35" y="73" textAnchor="middle" className="fill-background text-[8px] font-medium">5</text>

								{/* Arrow pointing to start */}
								<path d="M28 52 L22 58" stroke="#06b6d4" strokeWidth="2" fill="none" markerEnd="url(#arrowhead)" />
							</svg>

							<div className="flex items-center justify-center gap-1.5 text-[11px]">
								<span className="w-3 h-3 rounded-full bg-cyan-500 flex items-center justify-center flex-shrink-0">
									<span className="text-[8px] font-bold text-white">1</span>
								</span>
								<span className="font-medium text-foreground">{t('polygon.startEnd')}</span>
								<span className="text-muted-foreground">— {t('polygon.clickHereToClose')}</span>
							</div>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};
