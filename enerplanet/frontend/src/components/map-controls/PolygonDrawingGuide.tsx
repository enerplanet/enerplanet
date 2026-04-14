import { useState, useEffect, type FC } from "react";
import { X, MousePointer2, CircleDot, Check, Move, Plus, Trash2, Edit3, Grid3X3, Building2, Activity, Loader2, ChevronDown, ChevronUp, RotateCcw } from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";
import { useMapStore } from "@/features/interactive-map/store/map-store";

// Custom transformer icon matching the SVG asset
const TransformerIcon: FC<{ className?: string }> = ({ className }) => (
	<svg className={className} viewBox="0 0 24 24" fill="none">
		<ellipse cx="12" cy="8" rx="7" ry="2" fill="currentColor" opacity="0.9"/>
		<rect x="5" y="8" width="14" height="10" fill="currentColor" opacity="0.95"/>
		<ellipse cx="12" cy="18" rx="7" ry="2" fill="currentColor" opacity="0.85"/>
		<rect x="7" y="3" width="1.5" height="5" rx="0.5" fill="currentColor"/>
		<circle cx="7.75" cy="2.5" r="1" fill="currentColor"/>
		<rect x="11.25" y="3" width="1.5" height="5" rx="0.5" fill="currentColor"/>
		<circle cx="12" cy="2.5" r="1" fill="currentColor"/>
		<rect x="15.5" y="3" width="1.5" height="5" rx="0.5" fill="currentColor"/>
		<circle cx="16.25" cy="2.5" r="1" fill="currentColor"/>
	</svg>
);

interface PolygonDrawingGuideProps {
	/** Whether polygon drawing is available (no polygon exists yet or multiple allowed) */
	canDraw: boolean;
	/** Whether user is currently drawing */
	isDrawing: boolean;
	/** Number of existing polygons */
	polygonCount: number;
	/** Number of points in current drawing */
	currentPointCount?: number;
	/** Whether editing is enabled for completed polygons */
	enableEditing?: boolean;
	/** Whether grid is currently being generated */
	isGeneratingGrid?: boolean;
	/** Whether grid data has been loaded */
	hasGridData?: boolean;
	/** Whether power flow analysis is running */
	isRunningPowerFlow?: boolean;
	/** Whether power flow results are available */
	hasPowerFlowResults?: boolean;
}

export const PolygonDrawingGuide: FC<PolygonDrawingGuideProps> = ({
	canDraw,
	isDrawing,
	polygonCount,
	currentPointCount = 0,
	enableEditing = true,
	isGeneratingGrid = false,
	hasGridData = false,
	isRunningPowerFlow = false,
	hasPowerFlowResults = false,
}) => {
	const { t } = useTranslation();
	const [isDrawGuideVisible, setIsDrawGuideVisible] = useState(true);
	const [isDrawGuideDismissed, setIsDrawGuideDismissed] = useState(false);
	const [isEditGuideVisible, setIsEditGuideVisible] = useState(false);
	const [isEditGuideDismissed, setIsEditGuideDismissed] = useState(false);
	const [isEditExpanded, setIsEditExpanded] = useState(true);
	const [isWorkflowExpanded, setIsWorkflowExpanded] = useState(true);
	const [expandedStep, setExpandedStep] = useState<string | null>('transformer');
	const isMapLibre3D = useMapStore(s => s.selectedBaseLayerId === 'maplibre_3d');

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

	// Show edit guide when polygon exists
	useEffect(() => {
		if (polygonCount > 0 && enableEditing && !isEditGuideDismissed) {
			setIsEditGuideVisible(true);
		} else if (polygonCount === 0) {
			setIsEditGuideVisible(false);
			// Reset dismissed state when polygon is cleared so it shows again for new polygons
			setIsEditGuideDismissed(false);
		}
	}, [polygonCount, enableEditing, isEditGuideDismissed]);

	const handleDismissDrawGuide = () => {
		setIsDrawGuideDismissed(true);
		setIsDrawGuideVisible(false);
	};

	const handleDismissEditGuide = () => {
		setIsEditGuideDismissed(true);
		setIsEditGuideVisible(false);
	};

	// Show nothing if both guides are hidden
	if (!isDrawGuideVisible && !isEditGuideVisible) return null;

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

	// Workflow step status helper
	const getWorkflowStepStatus = (step: 'grid' | 'transformer' | 'buildings' | 'powerflow') => {
		switch (step) {
			case 'grid':
				if (isGeneratingGrid) return 'active';
				if (hasGridData) return 'complete';
				return 'pending';
			case 'transformer':
				if (!hasGridData) return 'pending';
				return 'available';
			case 'buildings':
				if (!hasGridData) return 'pending';
				return 'available';
			case 'powerflow':
				if (isRunningPowerFlow) return 'active';
				if (hasPowerFlowResults) return 'complete';
				if (!hasGridData) return 'pending';
				return 'available';
		}
	};

	// Edit guide (shown when polygon exists)
	if (isEditGuideVisible) {
		const workflowSteps = [
			{
				key: 'grid' as const,
				icon: Grid3X3,
				title: t('workflow.gridGeneration', 'Grid Generation'),
				description: t('workflow.gridGenerationHint', 'Analyzing buildings & creating grid'),
				auto: true,
			},
			{
				key: 'powerflow' as const,
				icon: Activity,
				title: t('workflow.powerFlow', 'Run Power Flow'),
				description: t('workflow.powerFlowHint', 'Analyze grid load & utilization'),
				auto: true,
			},
			{
				key: 'transformer' as const,
				icon: TransformerIcon,
				title: t('workflow.addTransformer', 'Add Transformer'),
				description: t('workflow.addTransformerHint', 'Place transformers on the map'),
				auto: false,
			},
			{
				key: 'buildings' as const,
				icon: Building2,
				title: t('workflow.assignBuildings', 'Assign Buildings'),
				description: t('workflow.assignBuildingsHint', 'Link buildings to transformers'),
				auto: false,
			},
		];

		return (
			<div
				className="absolute z-40 animate-in slide-in-from-right-2 fade-in duration-300 flex flex-col"
				style={{
					top: "10rem",
					maxHeight: "calc(100vh - 14rem)",
					right: "calc(1rem + var(--sidebar-offset, 0rem))"
				}}
			>
				<div className="relative w-64 max-h-full flex flex-col bg-card/98 backdrop-blur-md border border-border rounded-lg shadow-xl overflow-hidden">
					{/* Close button */}
					<button
						onClick={handleDismissEditGuide}
						className="absolute top-2 right-2 p-1 rounded-full hover:bg-muted/80 transition-colors text-muted-foreground hover:text-foreground z-10 bg-card/80"
						aria-label="Dismiss guide"
					>
						<X className="w-3.5 h-3.5" />
					</button>

					{/* Scrollable Content */}
					<div className="overflow-y-auto flex-1 p-4">
						{/* Edit Polygon Section - Collapsible */}
						<button
							onClick={() => setIsEditExpanded(!isEditExpanded)}
							className="w-full flex items-center justify-between mb-2"
						>
							<h4 className="text-sm font-semibold text-foreground flex items-center gap-2">
								<Edit3 className="w-4 h-4 text-primary" />
								{t('polygon.editPolygon', 'Edit Polygon')}
							</h4>
							{isEditExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
						</button>

						{isEditExpanded && (
							<div className="space-y-2 mb-3">
								{/* Move vertices */}
								<div className="flex items-center gap-2">
									<div className="flex-shrink-0 w-6 h-6 rounded bg-muted flex items-center justify-center">
										<Move className="w-3.5 h-3.5 text-foreground" />
									</div>
									<div className="flex-1 min-w-0">
										<p className="text-xs font-medium text-foreground">{t('polygon.moveVertex', 'Move corners')}</p>
									</div>
								</div>

								{/* Add vertex */}
								<div className="flex items-center gap-2">
									<div className="flex-shrink-0 w-6 h-6 rounded bg-muted flex items-center justify-center">
										<Plus className="w-3.5 h-3.5 text-foreground" />
									</div>
									<div className="flex-1 min-w-0">
										<p className="text-xs font-medium text-foreground">{t('polygon.addVertex', 'Add point')}</p>
									</div>
								</div>

								{/* Remove vertex */}
								<div className="flex items-center gap-2">
									<div className="flex-shrink-0 w-6 h-6 rounded bg-muted flex items-center justify-center">
										<Trash2 className="w-3.5 h-3.5 text-foreground" />
									</div>
									<div className="flex-1 min-w-0">
										<p className="text-xs font-medium text-foreground">
											<kbd className="px-1.5 py-0.5 bg-muted border border-border rounded text-[10px] font-mono">Alt</kbd>
											<span className="mx-1">+</span>
											<span>{t('polygon.removeVertexHint', 'click on vertex')}</span>
										</p>
									</div>
								</div>

								{/* Escape hint */}
								<div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-1">
									<kbd className="px-1.5 py-0.5 bg-muted border border-border rounded text-[10px] font-mono">Esc</kbd>
									<span>{t('polygon.escToClear', 'to clear polygon')}</span>
								</div>

								{/* 3D rotation hint — only when 3D buildings map is active */}
								{isMapLibre3D && (
									<div className="flex items-center gap-2 mt-2 pt-2 border-t border-border/50">
										<div className="flex-shrink-0 w-6 h-6 rounded bg-primary/10 flex items-center justify-center">
											<RotateCcw className="w-3.5 h-3.5 text-primary" />
										</div>
										<div className="flex-1 min-w-0">
											<p className="text-xs font-semibold text-foreground/90">{t('polygon.rotate3d', '3D View')}</p>
											<p className="text-[10px] text-muted-foreground">{t('polygon.rotate3dHint', 'Right-click + drag to rotate and see buildings in 3D')}</p>
										</div>
									</div>
								)}
							</div>
						)}

						{/* Workflow Section - Collapsible */}
						<div className="border-t border-border/50 pt-3">
							<button
								onClick={() => setIsWorkflowExpanded(!isWorkflowExpanded)}
								className="w-full flex items-center justify-between mb-2"
							>
								<p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
									{t('workflow.title', 'Workflow')}
								</p>
								{isWorkflowExpanded ? <ChevronUp className="w-4 h-4 text-muted-foreground" /> : <ChevronDown className="w-4 h-4 text-muted-foreground" />}
							</button>

							{isWorkflowExpanded && (
								<div className="space-y-2">
									{workflowSteps.map((step) => {
										const status = getWorkflowStepStatus(step.key);
										const StepIcon = step.icon;
										const isStepExpanded = expandedStep === step.key;
										const hasAnimation = (step.key === 'transformer' || step.key === 'buildings') && status === 'available';

										return (
											<div key={step.key} className="space-y-1">
												{/* Step header - clickable if has animation */}
												<button
													onClick={() => hasAnimation && setExpandedStep(isStepExpanded ? null : step.key)}
													className={`w-full flex items-center gap-2.5 py-1 ${hasAnimation ? 'cursor-pointer hover:bg-muted/50 rounded px-1 -mx-1' : 'cursor-default'}`}
													disabled={!hasAnimation}
												>
													{/* Status indicator */}
													<div className={`flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center transition-all duration-300 ${
														status === 'active'
															? 'bg-amber-500/20 border border-amber-500'
															: status === 'complete'
																? 'bg-emerald-500 border border-emerald-500'
																: status === 'available'
																	? 'bg-primary/10 border border-primary/50'
																	: 'bg-muted border border-muted-foreground/20'
													}`}>
														{status === 'active' ? (
															<Loader2 className="w-3 h-3 text-amber-500 animate-spin" />
														) : status === 'complete' ? (
															<Check className="w-3 h-3 text-white" />
														) : (
															<StepIcon className={`w-2.5 h-2.5 ${
																status === 'available' ? 'text-primary' : 'text-muted-foreground/50'
															}`} />
														)}
													</div>

													{/* Step title */}
													<p className={`flex-1 text-left text-xs font-medium transition-colors duration-300 ${
														status === 'active'
															? 'text-amber-600 dark:text-amber-400'
															: status === 'complete'
																? 'text-emerald-600 dark:text-emerald-400'
																: status === 'available'
																	? 'text-foreground'
																	: 'text-muted-foreground/60'
													}`}>
														{step.title}
														{step.auto && status === 'active' && (
															<span className="ml-1 text-[10px] text-amber-500 animate-pulse">auto</span>
														)}
													</p>

													{/* Expand/collapse indicator for steps with animations */}
													{hasAnimation && (
														isStepExpanded 
															? <ChevronUp className="w-4 h-4 text-muted-foreground" />
															: <ChevronDown className="w-4 h-4 text-muted-foreground" />
													)}
												</button>

												{/* Add Transformer illustration - collapsible */}
												{step.key === 'transformer' && status === 'available' && isStepExpanded && (
													<div className="mt-2 animate-in fade-in slide-in-from-top-2 duration-300 space-y-2 bg-muted/30 rounded-lg p-2">
														{/* Step 1: Click Add Transformer button */}
														<div className="space-y-1.5">
															<p className="text-[10px] font-semibold text-primary flex items-center gap-1">
																<svg className="w-3 h-3" viewBox="0 0 24 24" fill="none">
																	<ellipse cx="12" cy="8" rx="7" ry="2" fill="currentColor" opacity="0.9"/>
																	<rect x="5" y="8" width="14" height="10" fill="currentColor" opacity="0.95"/>
																	<ellipse cx="12" cy="18" rx="7" ry="2" fill="currentColor" opacity="0.85"/>
																	<rect x="7" y="3" width="1.5" height="5" rx="0.5" fill="currentColor"/>
																	<circle cx="7.75" cy="2.5" r="1" fill="currentColor"/>
																	<rect x="11.25" y="3" width="1.5" height="5" rx="0.5" fill="currentColor"/>
																	<circle cx="12" cy="2.5" r="1" fill="currentColor"/>
																	<rect x="15.5" y="3" width="1.5" height="5" rx="0.5" fill="currentColor"/>
																	<circle cx="16.25" cy="2.5" r="1" fill="currentColor"/>
																</svg>
																Step 1: {t('workflow.clickAddTransformer', 'Click button in bottom bar')}
															</p>
															<div className="flex justify-center">
																<div className="flex items-center gap-1.5 bg-card border border-border rounded-full px-2 py-1 shadow-sm">
																	<svg className="w-3 h-3 text-green-500" viewBox="0 0 24 24" fill="none">
																		<ellipse cx="12" cy="8" rx="7" ry="2" fill="currentColor" opacity="0.9"/>
																		<rect x="5" y="8" width="14" height="10" fill="currentColor" opacity="0.95"/>
																		<ellipse cx="12" cy="18" rx="7" ry="2" fill="currentColor" opacity="0.85"/>
																		<rect x="7" y="3" width="1.5" height="5" rx="0.5" fill="currentColor"/>
																		<circle cx="7.75" cy="2.5" r="1" fill="currentColor"/>
																		<rect x="11.25" y="3" width="1.5" height="5" rx="0.5" fill="currentColor"/>
																		<circle cx="12" cy="2.5" r="1" fill="currentColor"/>
																		<rect x="15.5" y="3" width="1.5" height="5" rx="0.5" fill="currentColor"/>
																		<circle cx="16.25" cy="2.5" r="1" fill="currentColor"/>
																	</svg>
																	<span className="text-[10px] font-medium">{t('workflow.addTransformerAction', 'Add Transformer')}</span>
																</div>
															</div>
														</div>

														{/* Step 2: Click on map */}
														<div className="space-y-1.5">
															<p className="text-[10px] font-semibold text-amber-500 flex items-center gap-1">
																<svg className="w-3 h-3" viewBox="0 0 24 24" fill="none">
																	<ellipse cx="12" cy="8" rx="7" ry="2" fill="currentColor" opacity="0.9"/>
																	<rect x="5" y="8" width="14" height="10" fill="currentColor" opacity="0.95"/>
																	<ellipse cx="12" cy="18" rx="7" ry="2" fill="currentColor" opacity="0.85"/>
																	<rect x="7" y="3" width="1.5" height="5" rx="0.5" fill="currentColor"/>
																	<circle cx="7.75" cy="2.5" r="1" fill="currentColor"/>
																	<rect x="11.25" y="3" width="1.5" height="5" rx="0.5" fill="currentColor"/>
																	<circle cx="12" cy="2.5" r="1" fill="currentColor"/>
																	<rect x="15.5" y="3" width="1.5" height="5" rx="0.5" fill="currentColor"/>
																	<circle cx="16.25" cy="2.5" r="1" fill="currentColor"/>
																</svg>
																Step 2: {t('workflow.clickOnMapInPolygon', 'Click on map inside polygon')}
															</p>
															<svg width="100%" height="55" viewBox="0 0 180 55" className="text-foreground">
																{/* Map area */}
																<rect x="0" y="0" width="180" height="55" rx="4" className="fill-muted/40 stroke-border" strokeWidth="1" strokeDasharray="4 3" />
																
																{/* Grid lines */}
																<line x1="60" y1="0" x2="60" y2="55" className="stroke-border/30" strokeWidth="0.5" />
																<line x1="120" y1="0" x2="120" y2="55" className="stroke-border/30" strokeWidth="0.5" />
																<line x1="0" y1="27" x2="180" y2="27" className="stroke-border/30" strokeWidth="0.5" />

																{/* Cursor clicking */}
																<g>
																	<animateTransform attributeName="transform" type="translate" values="0,0; 0,2; 0,0" dur="1.5s" repeatCount="indefinite" />
																	<path d="M80,10 L80,24 L84,20 L88,26 L91,25 L87,19 L92,17 Z" className="fill-foreground/70 stroke-foreground" strokeWidth="0.5" />
																</g>

																{/* Ripple at click */}
																<circle cx="80" cy="10" r="3" fill="none" className="stroke-amber-500" strokeWidth="1.5">
																	<animate attributeName="r" values="3;14;3" dur="2s" repeatCount="indefinite" />
																	<animate attributeName="opacity" values="0.8;0;0.8" dur="2s" repeatCount="indefinite" />
																</circle>

																{/* Transformer icon appearing */}
																<g opacity="0" transform="translate(68, 2)">
																	<animate attributeName="opacity" values="0;0;1;1" dur="2s" repeatCount="indefinite" />
																	<rect x="0" y="0" width="24" height="24" rx="4" className="fill-amber-500/20 stroke-amber-500" strokeWidth="1.5" />
																	<g transform="translate(0, 0) scale(1)">
																		<ellipse cx="12" cy="8" rx="5" ry="1.5" className="fill-amber-500" opacity="0.9"/>
																		<rect x="7" y="8" width="10" height="8" className="fill-amber-500" opacity="0.95"/>
																		<ellipse cx="12" cy="16" rx="5" ry="1.5" className="fill-amber-500" opacity="0.85"/>
																		<rect x="9" y="4" width="1" height="4" rx="0.3" className="fill-amber-500"/>
																		<circle cx="9.5" cy="3.5" r="0.7" className="fill-amber-500"/>
																		<rect x="11.5" y="4" width="1" height="4" rx="0.3" className="fill-amber-500"/>
																		<circle cx="12" cy="3.5" r="0.7" className="fill-amber-500"/>
																		<rect x="14" y="4" width="1" height="4" rx="0.3" className="fill-amber-500"/>
																		<circle cx="14.5" cy="3.5" r="0.7" className="fill-amber-500"/>
																	</g>
																</g>
															</svg>
														</div>
													</div>
												)}

												{/* Assign Buildings illustration - collapsible */}
												{step.key === 'buildings' && status === 'available' && isStepExpanded && (
													<div className="mt-2 animate-in fade-in slide-in-from-top-2 duration-300 space-y-2 bg-muted/30 rounded-lg p-2">
														{/* Step 1: Click buildings */}
														<div className="space-y-1.5">
															<p className="text-[10px] font-semibold text-primary">Step 1: {t('workflow.clickToSelectBuilding', 'Click to select a building')}</p>
															<svg width="100%" height="55" viewBox="0 0 140 45" className="text-foreground">
																{/* Building 1 — selected */}
																<rect x="15" y="5" width="35" height="28" rx="4" className="fill-blue-500/25 stroke-blue-500" strokeWidth="2">
																	<animate attributeName="stroke-opacity" values="0.5;1;0.5" dur="1.5s" repeatCount="indefinite" />
																</rect>
																<rect x="20" y="10" width="8" height="8" rx="1.5" className="fill-blue-400/50" />
																<rect x="32" y="10" width="8" height="8" rx="1.5" className="fill-blue-400/50" />
																<rect x="20" y="21" width="8" height="8" rx="1.5" className="fill-blue-400/50" />
																<rect x="32" y="21" width="8" height="8" rx="1.5" className="fill-blue-400/50" />

																{/* Building 2 — selected */}
																<rect x="60" y="5" width="35" height="28" rx="4" className="fill-blue-500/25 stroke-blue-500" strokeWidth="2">
																	<animate attributeName="stroke-opacity" values="0.5;1;0.5" dur="1.5s" repeatCount="indefinite" begin="0.3s" />
																</rect>
																<rect x="65" y="10" width="8" height="8" rx="1.5" className="fill-blue-400/50" />
																<rect x="77" y="10" width="8" height="8" rx="1.5" className="fill-blue-400/50" />
																<rect x="65" y="21" width="8" height="8" rx="1.5" className="fill-blue-400/50" />
																<rect x="77" y="21" width="8" height="8" rx="1.5" className="fill-blue-400/50" />

																{/* Click cursor */}
																<g>
																	<animateTransform attributeName="transform" type="translate" values="0,0; 0,3; 0,0" dur="1.2s" repeatCount="indefinite" />
																	<path d="M75,30 L75,42 L79,38 L83,44 L87,42 L83,37 L88,34 Z" className="fill-foreground/70 stroke-foreground" strokeWidth="0.5" />
																</g>
															</svg>
														</div>

														{/* Arrow */}
														<div className="flex items-center justify-center gap-2">
															<div className="h-px w-4 bg-muted-foreground/30" />
															<span className="text-[10px] text-muted-foreground">{t('workflow.then', 'then')}</span>
															<div className="h-px w-4 bg-muted-foreground/30" />
														</div>

														{/* Step 2: Click transformer */}
														<div className="space-y-1.5">
															<p className="text-[10px] font-semibold text-amber-500">Step 2: {t('workflow.clickTransformer', 'Click transformer')}</p>
															<svg width="100%" height="55" viewBox="0 0 140 50" className="text-foreground">
																{/* Buildings on left side */}
																<rect x="5" y="5" width="22" height="16" rx="2" className="fill-primary/15 stroke-primary/40" strokeWidth="1" />
																<rect x="8" y="8" width="5" height="4" rx="0.5" className="fill-primary/30" />
																<rect x="15" y="8" width="5" height="4" rx="0.5" className="fill-primary/30" />
																<rect x="5" y="28" width="22" height="16" rx="2" className="fill-primary/15 stroke-primary/40" strokeWidth="1" />
																<rect x="8" y="31" width="5" height="4" rx="0.5" className="fill-primary/30" />
																<rect x="15" y="31" width="5" height="4" rx="0.5" className="fill-primary/30" />

																{/* Connected lines from buildings to transformer */}
																<line x1="27" y1="13" x2="55" y2="20" className="stroke-primary/60" strokeWidth="1.5" strokeDasharray="3 2">
																	<animate attributeName="stroke-dashoffset" from="30" to="0" dur="1.2s" fill="freeze" begin="0.3s" />
																</line>
																<line x1="27" y1="36" x2="55" y2="30" className="stroke-primary/60" strokeWidth="1.5" strokeDasharray="3 2">
																	<animate attributeName="stroke-dashoffset" from="30" to="0" dur="1.2s" fill="freeze" begin="0.5s" />
																</line>

																{/* Transformer box on right */}
																<rect x="55" y="5" width="40" height="40" rx="5" className="fill-amber-500/20 stroke-amber-500" strokeWidth="2" />
																
																{/* Transformer icon inside */}
																<g transform="translate(63, 10)">
																	<ellipse cx="12" cy="6" rx="8" ry="2.5" className="fill-amber-500" opacity="0.9"/>
																	<rect x="4" y="6" width="16" height="14" className="fill-amber-500" opacity="0.95"/>
																	<ellipse cx="12" cy="20" rx="8" ry="2.5" className="fill-amber-500" opacity="0.85"/>
																	<rect x="7" y="1" width="2" height="5" rx="0.5" className="fill-amber-500"/>
																	<circle cx="8" cy="0.5" r="1.2" className="fill-amber-500"/>
																	<rect x="11" y="1" width="2" height="5" rx="0.5" className="fill-amber-500"/>
																	<circle cx="12" cy="0.5" r="1.2" className="fill-amber-500"/>
																	<rect x="15" y="1" width="2" height="5" rx="0.5" className="fill-amber-500"/>
																	<circle cx="16" cy="0.5" r="1.2" className="fill-amber-500"/>
																</g>

																{/* Click cursor on transformer */}
																<g>
																	<animateTransform attributeName="transform" type="translate" values="0,0; 0,3; 0,0" dur="1.2s" repeatCount="indefinite" />
																	<path d="M100,18 L100,32 L105,28 L109,35 L113,33 L109,27 L115,24 Z" className="fill-foreground/70 stroke-foreground" strokeWidth="0.5" />
																</g>

																{/* Dots traveling from buildings to transformer */}
																<circle r="2.5" className="fill-primary">
																	<animateMotion dur="1.8s" repeatCount="indefinite" path="M27,13 L55,20" begin="0.5s" />
																</circle>
																<circle r="2.5" className="fill-primary">
																	<animateMotion dur="1.8s" repeatCount="indefinite" path="M27,36 L55,30" begin="1s" />
																</circle>
															</svg>
														</div>
													</div>
												)}
											</div>
										);
									})}
								</div>
							)}
						</div>
					</div>
				</div>
			</div>
		);
	}

	// Draw guide (shown when no polygon exists)
	if (!isDrawGuideVisible) return null;

	return (
		<div
			className="absolute z-40 animate-in slide-in-from-right-2 fade-in duration-300"
			style={{
				top: "calc(4rem + 8rem)",
				right: "calc(1rem + var(--sidebar-offset, 0rem))"
			}}
		>
			<div className="relative w-64 bg-card/98 backdrop-blur-md border border-border rounded-lg shadow-xl overflow-hidden">
				{/* Close button */}
				<button
					onClick={handleDismissDrawGuide}
					className="absolute top-2 right-2 p-1 rounded-full hover:bg-muted/80 transition-colors text-muted-foreground hover:text-foreground"
					aria-label="Dismiss guide"
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

					{/* Escape hint - show when drawing */}
					{isDrawing && (
						<div className="mt-3 flex items-center justify-center gap-2 text-[10px] text-muted-foreground">
							<kbd className="px-1.5 py-0.5 bg-muted border border-border rounded text-[9px] font-mono">Esc</kbd>
							<span>{t('polygon.escToCancel')}</span>
						</div>
					)}
				</div>
			</div>
		</div>
	);
};
