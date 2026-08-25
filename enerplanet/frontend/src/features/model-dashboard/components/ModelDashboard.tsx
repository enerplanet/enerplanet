import React, { Fragment, useState, useCallback, useEffect, useMemo } from "react";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useNavigate, useLocation } from "react-router-dom";
import {
	Plus,
	Settings,
	Search,
	ArrowUpDown,
	RefreshCw,
	ChevronUp,
	ChevronDown,
	Trash2,
	Share,
	FolderInput,
	Copy,
	Edit,
	BarChart3,
	AlertCircle,
	Play,
	GitCompareArrows,
} from "lucide-react";

import { Model, ModelStats } from "@/features/model-dashboard/services/modelService";
import { ModelStatsSummary } from "./ModelStatsSummary";
import { PageHeader } from "@/components/ui/PageHeader";
import { ListSkeleton } from "@/components/ui/Skeletons";
import {
	CARD_CLASS,
	DANGER_BUTTON_CLASS,
	PAGE_SHELL_CLASS,
	PRIMARY_BUTTON_CLASS,
	SEARCH_INPUT_CLASS,
	TOOLBAR_BUTTON_CLASS,
	TOOLBAR_ICON_BUTTON_CLASS,
} from "@/components/ui/toolbar";
import { Tooltip, TooltipTrigger, TooltipContent } from "@spatialhub/ui";
import Pagination from "@/components/ui/Pagination";
import { useConfirm } from "@/hooks/useConfirmDialog";
import Chip from "@/components/ui/Chip";
import {
	useModelsQuery,
	useModelStatsQuery,
	useMissingParentsQuery,
} from "@/features/model-dashboard/hooks/useModelsQuery";
import { WorkspaceSelector } from "@/components/workspace/WorkspaceSelector";
import { CreateWorkspaceModal } from "@/components/workspace/CreateWorkspaceModal";
import { ShareWorkspaceModal } from "@/components/workspace/ShareWorkspaceModal";
import { RenameWorkspaceModal, CopyWorkspaceModal } from "@/components/workspace/WorkspaceModals";
import { MoveModelModal } from "@/components/workspace/MoveModelModal";
import { ShareModelModal } from "@/features/model-dashboard/components/ShareModelModal";
import { BulkCopyModal } from "@/features/model-dashboard/components/BulkCopyModal";
import { useNotification } from "@/features/notifications/hooks/useNotification";
import Notification from "@/components/ui/Notification";
import { type Workspace, workspaceService } from "@/components/workspace/services/workspaceService";
import { useWorkspaceStore } from "@/components/workspace/store/workspace-store";
import { useAuthStore } from "@/store/auth-store";
import { useModelDashboardHandlers } from '@/features/model-dashboard/hooks/useModelDashboardHandlers';
import { useModelSelection } from '@/features/model-dashboard/hooks/useModelSelection';
import { useBulkOperations } from '@/features/model-dashboard/hooks/useBulkOperations';
import { useDeleteConfirm } from '@/hooks/useDeleteConfirm';
import ModelActionGroup, { type ActionConfig } from "@/components/shared/ModelActionGroup";
import { useFavoriteModelsStore } from "@/features/model-dashboard/store/favorite-models";
import { isModelDisabled as checkModelDisabled, isModelCompleted } from "@/features/model-dashboard/utils/statusHelpers";
import { ModelTableRow } from "./ModelTableRow";
import { useWebservices } from "@/features/admin-dashboard/hooks/useWebservices";
import { processModelTimingUpdates, type TimingUpdate } from "@/features/model-dashboard/utils/modelTimingUtils";
import { organizeModelsHierarchically } from "@/features/model-dashboard/utils/dashboardHelpers";
import { useTranslation } from "@spatialhub/i18n";

interface Group {
	id: number;
	name: string;
	ids: number[];
	[key: string]: string | number | number[];
}

interface WorkspaceMember {
	user_id: number | string;
	email?: string;
}

interface EnergyRiskDashboardProps {
	type?: string;
}

function checkOwnership(
	ownerId: number | string | null | undefined,
	ownerEmail: string | null | undefined,
	user: { id?: number | string | null; email?: string | null }
): boolean {
	const userIdStr = user.id !== undefined && user.id !== null ? String(user.id) : "";
	const ownerIdStr = ownerId ? String(ownerId) : "";
	const idMatches = userIdStr && ownerIdStr && userIdStr === ownerIdStr;
	
	const emailMatches = ownerEmail && user.email
		? ownerEmail.toLowerCase() === user.email.toLowerCase()
		: false;
	
	return Boolean(idMatches || emailMatches);
}

interface SortHeaderButtonProps {
	field: string;
	label: string;
	orderBy: string;
	order: "asc" | "desc";
	onSort: (field: string) => void;
}

function SortHeaderButton({ field, label, orderBy, order, onSort }: SortHeaderButtonProps) {
	const isActive = orderBy === field;

	return (
		<button
			onClick={() => onSort(field)}
			className="group/sort inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors duration-150 hover:text-foreground"
		>
			{label}
			{isActive ? (
				<span className="flex h-4 w-4 items-center justify-center rounded bg-muted text-foreground">
					{order === "asc" ? (
						<ChevronUp className="h-3 w-3" />
					) : (
						<ChevronDown className="h-3 w-3" />
					)}
				</span>
			) : (
				<ArrowUpDown className="h-3 w-3 opacity-0 transition-opacity duration-150 group-hover/sort:opacity-50" />
			)}
		</button>
	);
}

// eslint-disable-next-line sonarjs/cognitive-complexity -- Large component with complex state management, permission checks, and UI logic
export const EnergyRiskDashboard: React.FC<EnergyRiskDashboardProps> = () => {
	const { t } = useTranslation();
	useDocumentTitle(t('model.dashboard'), ' | EnerPlanET');

	const navigate = useNavigate();
	const location = useLocation();
	const confirm = useConfirm();
	const passedWorkspaceId = location.state?.workspaceId;
	const normalizedWorkspaceId = typeof passedWorkspaceId === "number" ? passedWorkspaceId : undefined;

	const currentWorkspace = useWorkspaceStore(state => state.currentWorkspace);
	const preferredWorkspaceId = useWorkspaceStore(state => state.preferredWorkspaceId);
	const isLoadingWorkspace = useWorkspaceStore(state => state.isLoading);
	const setCurrentWorkspace = useWorkspaceStore(state => state.setCurrentWorkspace);
	const initializeWorkspace = useWorkspaceStore(state => state.initializeWorkspace);
    const user = useAuthStore(state => state.user);

	const [isCreateWsOpen, setIsCreateWsOpen] = useState(false);
	const [isShareWsOpen, setIsShareWsOpen] = useState(false);
	const [isRenameWsOpen, setIsRenameWsOpen] = useState(false);
	const [isCopyWsOpen, setIsCopyWsOpen] = useState(false);
	const [wsReloadKey, setWsReloadKey] = useState(0);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const { notification, showSuccess, showError, hide: hideNotification } = useNotification();

	useEffect(() => {
		initializeWorkspace();
	}, [initializeWorkspace]);
	const isWorkspaceOwner = React.useMemo(() => {
		if (!currentWorkspace || !user) return false;
		return checkOwnership(currentWorkspace.user_id, currentWorkspace.user_email, user);
	}, [currentWorkspace, user]);

	const canManageWorkspace = React.useMemo(() => {
		if (!currentWorkspace || !user) return false;
		if (isWorkspaceOwner) return true;
		if (user.access_level === 'expert') {
			const members = currentWorkspace.members || [];
			const groups = currentWorkspace.groups || [];
			const userIdStr = String(user.id ?? '');
			const isMember = members.some((m: WorkspaceMember) => String(m.user_id) === userIdStr || (m.email && user.email && m.email.toLowerCase() === user.email.toLowerCase()));
			const hasGroup = Array.isArray(groups) && groups.length > 0;
			return isMember || hasGroup;
		}
		return false;
	}, [currentWorkspace, user, isWorkspaceOwner]);

	const canUserDeleteModel = React.useCallback((model: Model): boolean => {
		if (!user) return false;

		const isModelOwner = checkOwnership(model.user_id, model.user_email, user);
		if (isModelOwner) return true;

		return user.access_level === 'expert';
	}, [user]);

	useEffect(() => {
		if (normalizedWorkspaceId && preferredWorkspaceId !== normalizedWorkspaceId) {
			/* handled upstream */
		}
	}, [normalizedWorkspaceId, preferredWorkspaceId]);

	const [groups] = useState<Group[]>([]);
	const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
	
	// Default stats for when data is not yet loaded
	const defaultStats: ModelStats = {
		total: 0,
		draft: 0,
		queue: 0,
		running: 0,
		completed: 0,
		published: 0,
		failed: 0,
		cancelled: 0,
		model_limit: 0,
		remaining: -1,
		is_unlimited: false,
	};

	const [calculationStartTimes, setCalculationStartTimes] = useState<Record<number, string>>(() => {
		try {
			const saved = localStorage.getItem('modelCalculationStartTimes');
			return saved ? JSON.parse(saved) : {};
		} catch {
			return {};
		}
	});
	const [calculationCompletionInfo, setCalculationCompletionInfo] = useState<Record<number, { startTime: string, endTime: string, totalSeconds: number }>>(() => {
		try {
			const saved = localStorage.getItem('modelCalculationCompletionInfo');
			return saved ? JSON.parse(saved) : {};
		} catch {
			return {};
		}
	});

	const [orderBy, setOrderBy] = useState<string>("created_at");
	const [order, setOrder] = useState<"asc" | "desc">("desc");
	const [filterText, setFilterText] = useState<string>("");
	const [currentPage, setCurrentPage] = useState<number>(0);
	const [itemsPerPage, setItemsPerPage] = useState<number>(10);
	const [currentWorkspaceId, setCurrentWorkspaceId] = useState<number | undefined>(undefined);

	const { data: modelsResponse, isLoading: isLoadingModels, refetch: refetchModels } = useModelsQuery({
		limit: itemsPerPage,
		offset: currentPage * itemsPerPage,
		search: filterText.trim() || undefined,
		workspace_id: currentWorkspaceId,
		sort_by: orderBy,
		sort_order: order,
	});

	const { data: statsResponse, isSuccess: statsLoaded } = useModelStatsQuery();

	const { summary: webserviceSummary } = useWebservices({}, { autoRefresh: true, refreshInterval: 10000 });
	const hasAvailableWebservice = (webserviceSummary?.available ?? 0) > 0;

	const modelsData = useMemo(() => modelsResponse?.data || [], [modelsResponse?.data]);

	// Identify parent models not on the current page but referenced by children
	const missingParentIds = useMemo(() => {
		const currentIds = new Set(modelsData.map(m => m.id));
		const parentIds = new Set<number>();
		for (const m of modelsData) {
			if (m.parent_model_id && !currentIds.has(m.parent_model_id)) {
				parentIds.add(m.parent_model_id);
			}
		}
		return Array.from(parentIds);
	}, [modelsData]);

	const { data: missingParents } = useMissingParentsQuery(missingParentIds);

	// Merge missing parents so they always appear with their copies
	const models = useMemo(() => {
		if (!missingParents?.length) return modelsData;
		const combined = [...modelsData];
		for (const parent of missingParents) {
			if (!combined.some(m => m.id === parent.id)) {
				combined.push(parent);
			}
		}
		return combined;
	}, [modelsData, missingParents]);
	const totalItems = modelsResponse?.total || 0;
	const isLoading = isLoadingModels;

	// Use stats directly from React Query, fallback to defaults
	const stats = useMemo(() => {
		if (statsResponse?.success && statsResponse.data) {
			return statsResponse.data;
		}
		return defaultStats;
	}, [statsResponse]);

	// Check if model limit is reached
	const isModelLimitReached = useMemo(() => {
		if (stats.is_unlimited) return false;
		if (!stats.model_limit) return false;
		return stats.total >= stats.model_limit;
	}, [stats.total, stats.model_limit, stats.is_unlimited]);

	// No-op function for compatibility - mutations handle cache invalidation automatically
	const loadStats = useCallback(async () => {
		// Stats are handled by React Query - mutations invalidate the cache
	}, []);

	const {
		selectedModels,
		editingModel,
		editTitle,
		isSelected,
		handleSelectModel,
		handleSelectAll,
		startTitleEdit,
		cancelTitleEdit,
		setEditTitle,
		clearSelection,
	} = useModelSelection();

	const {
		handleEdit,
		handleView,
		handleCopy,
		handleDelete,
		handleCalculate,
		handleDownload,
		updateTitle: updateTitleHandler,
		handleBulkDelete: bulkDeleteHandler,
	} = useModelDashboardHandlers({
		onRefresh: async () => { await refetchModels(); },
		onStatsRefresh: loadStats,
	});

	const setWorkspaceFilter = useCallback((workspaceId: number | undefined) => {
		setCurrentWorkspaceId(workspaceId);
		setCurrentPage(0);
	}, []);

	const handleWorkspaceChange = useCallback((workspace: Workspace | null) => {
		setCurrentWorkspace(workspace);
		setWorkspaceFilter(workspace?.id);
	}, [setCurrentWorkspace, setWorkspaceFilter]);

	const loadModels = useCallback(async () => {
		try {
			await refetchModels();
		} catch (error) {
			if (import.meta.env.DEV) console.error("Failed to refetch models:", error);
		}
	}, [refetchModels]);

	const handleRefresh = useCallback(async () => {
		setIsRefreshing(true);
		try {
			// Reload both workspaces and models
			setWsReloadKey((k) => k + 1);
			await loadModels();
		} finally {
			setTimeout(() => setIsRefreshing(false), 500);
		}
	}, [loadModels]);

	const handlePageChange = useCallback((page: number) => {
		setCurrentPage(page);
	}, []);

	const handleItemsPerPageChange = useCallback((newItemsPerPage: number) => {
		setItemsPerPage(newItemsPerPage);
		setCurrentPage(0);
	}, []);

	const handleSort = useCallback((field: string) => {
		const newOrder = orderBy === field && order === "asc" ? "desc" : "asc";
		setOrderBy(field);
		setOrder(newOrder);
		setCurrentPage(0);
	}, [orderBy, order]);

	const updateTitle = useCallback(async (): Promise<void> => {
		await updateTitleHandler(editingModel, editTitle);
		cancelTitleEdit();
	}, [editingModel, editTitle, updateTitleHandler, cancelTitleEdit]);

	const isModelDisabled = useCallback((model: Model): boolean => {
		return checkModelDisabled(model.status);
	}, []);

	const performBulkDelete = useCallback(async (): Promise<void> => {
		const deletableModels = selectedModels.filter((model: Model) => 
			!isModelDisabled(model) && canUserDeleteModel(model)
		);
		const deletableIds = deletableModels.map((m) => m.id);
		await bulkDeleteHandler(deletableIds);
		clearSelection();
	}, [selectedModels, isModelDisabled, canUserDeleteModel, bulkDeleteHandler, clearSelection]);

	const filteredModels = models;

	const favoriteIds = useFavoriteModelsStore(s => s.favoriteIds);
	const favoriteIdSet = useMemo(() => new Set(favoriteIds), [favoriteIds]);

	const sortedModels = useMemo(() => {
		// Server already sorts by orderBy/order — only reorder favorites to top
		return [...filteredModels].sort((a, b) => {
			const aFav = favoriteIdSet.has(a.id) ? 0 : 1;
			const bFav = favoriteIdSet.has(b.id) ? 0 : 1;
			return aFav - bFav;
		});
	}, [filteredModels, favoriteIdSet]);

	const orderedModels = useMemo(() => organizeModelsHierarchically(sortedModels), [sortedModels]);

	const paginatedModels = orderedModels;
	const modelTitlesByID = useMemo(() => {
		const titles = new Map<number, string>();
		for (const model of paginatedModels) {
			titles.set(model.id, model.title.trim());
		}
		return titles;
	}, [paginatedModels]);
	const childCountByParentID = useMemo(() => {
		const children = new Map<number, number>();
		for (const model of paginatedModels) {
			if (!model.parent_model_id) continue;
			children.set(model.parent_model_id, (children.get(model.parent_model_id) ?? 0) + 1);
		}
		return children;
	}, [paginatedModels]);

	const { showBulkDeleteConfirm } = useBulkOperations({
		selectedModels,
		sortedModels: orderedModels,
		isModelDisabled,
		onBulkDelete: performBulkDelete,
		onClearSelection: clearSelection,
		onLoadStats: loadStats,
	});

	const { handleSingleDelete } = useDeleteConfirm({
		sortedModels: orderedModels,
		onDelete: handleDelete,
		onLoadStats: loadStats,
	});

	useEffect(() => {
		if (isLoadingWorkspace) return;

		if (currentWorkspace) {
			setWorkspaceFilter(currentWorkspace.id);
		} else {
			setWorkspaceFilter(undefined);
		}
		loadStats();
	}, [isLoadingWorkspace, currentWorkspace, setWorkspaceFilter]);

	useEffect(() => {
		if (!models.length) return;

		const timingUpdate = processModelTimingUpdates(models, calculationStartTimes, calculationCompletionInfo);
		
		updateCalculationStartTimes(timingUpdate);
		updateCalculationCompletionInfo(timingUpdate);
	}, [models, calculationStartTimes, calculationCompletionInfo]);

	const updateCalculationStartTimes = (timingUpdate: TimingUpdate) => {
		if (timingUpdate.hasStartChanges) {
			setCalculationStartTimes(timingUpdate.updatedStartTimes);
			localStorage.setItem('modelCalculationStartTimes', JSON.stringify(timingUpdate.updatedStartTimes));
		}
	};

	const updateCalculationCompletionInfo = (timingUpdate: TimingUpdate) => {
		if (timingUpdate.hasCompletionChanges) {
			setCalculationCompletionInfo(timingUpdate.updatedCompletionInfo);
			localStorage.setItem('modelCalculationCompletionInfo', JSON.stringify(timingUpdate.updatedCompletionInfo));
		}
	};



	const [shareModal, setShareModal] = useState<{
		isOpen: boolean;
		model: Model | null;
	}>({
		isOpen: false,
		model: null,
	});


	const [moveModelModal, setMoveModelModal] = useState<{
		isOpen: boolean;
		model: Model | null;
		models?: Model[];
	}>({
		isOpen: false,
		model: null,
	});

	const [bulkCopyModal, setBulkCopyModal] = useState<{
		isOpen: boolean;
		models: Model[];
	}>({
		isOpen: false,
		models: [],
	});

	const handleCopyWorkspaceSuccess = async (copiedWorkspace: Workspace, sourceWorkspace: Workspace) => {
		try {
			// Reload workspace list to include the new workspace
			setWsReloadKey((k) => k + 1);
			// Switch to the new workspace
			handleWorkspaceChange(copiedWorkspace);
			await loadModels();
			await loadStats();

			showSuccess(`Workspace "${copiedWorkspace.name}" created successfully with all models copied from "${sourceWorkspace.name}".`);
		} catch (error) {
			if (import.meta.env.DEV) console.error("Failed to load copied workspace:", error);
			showError("Workspace copied but failed to load. Please refresh the page.");
		}
	};

	const handleRenameWorkspaceSuccess = async (updatedWorkspace: Workspace) => {
		try {
			// Update the current workspace
			setCurrentWorkspace(updatedWorkspace);
			setWsReloadKey((k) => k + 1);

			showSuccess(`Workspace renamed to "${updatedWorkspace.name}" successfully.`);
		} catch (error) {
			if (import.meta.env.DEV) console.error("Failed to update workspace:", error);
			showError("Workspace renamed but failed to refresh. Please reload the page.");
		}
	};

	const handleDeleteWorkspace = async () => {
		if (!currentWorkspace) return;

		await confirm({
			type: "delete",
			itemType: "workspace",
			itemName: currentWorkspace.name,
			description: `This will permanently delete the workspace "${currentWorkspace.name}" and all models in it. This action cannot be undone.`,
			onConfirm: async () => {
				try {
					await workspaceService.deleteWorkspace(currentWorkspace.id);
					// Load default workspace after deletion
					const defaultWorkspace = await workspaceService.getDefaultWorkspace();
					handleWorkspaceChange(defaultWorkspace);
					setWsReloadKey((k) => k + 1);
					await loadStats();
				} catch (error) {
					if (import.meta.env.DEV) console.error("Failed to delete workspace:", error);
					alert("Failed to delete workspace. Please try again.");
				}
			}
		});
	};

	const handleNewModel = (): void => {
		if (currentWorkspace) {
			navigate("/app/model-dashboard/new-model", {
				state: { workspaceId: currentWorkspace.id }
			});
		} else {
			navigate("/app/model-dashboard/new-model");
		}
	};

	const handleShare = useCallback((model: Model) => {
		setShareModal({
			isOpen: true,
			model,
		});
	}, []);

	const handleMoveToWorkspace = useCallback((model: Model) => {
		// Blur active element to prevent aria-hidden focus warning
		if (document.activeElement instanceof HTMLElement) {
			document.activeElement.blur();
		}
		setMoveModelModal({
			isOpen: true,
			model,
		});
	}, []);

	const handleBulkMoveToWorkspace = () => {
		// Blur active element to prevent aria-hidden focus warning
		if (document.activeElement instanceof HTMLElement) {
			document.activeElement.blur();
		}
		const ownedModels = selectedModels.filter((model: Model) => canUserDeleteModel(model));
		
		// Exclude parent models if their children are also being moved
		const modelsToMove = ownedModels.filter(model => {
			// Check if any selected model has this model as parent
			const hasChildInSelection = ownedModels.some(
				m => m.parent_model_id === model.id
			);
			return !hasChildInSelection;
		});
		
		setMoveModelModal({
			isOpen: true,
			model: null,
			models: modelsToMove,
		});
	};

	const canDeleteAnySelected = useMemo(() => {
		return selectedModels.some((model: Model) =>
			!isModelDisabled(model) && canUserDeleteModel(model)
		);
	}, [selectedModels, canUserDeleteModel, isModelDisabled]);

	const canMoveAnySelected = useMemo(() => {
		return selectedModels.some((model: Model) => canUserDeleteModel(model));
	}, [selectedModels, canUserDeleteModel]);

	const canCalculateAnySelected = useMemo(() => {
		return hasAvailableWebservice && selectedModels.some((model: Model) => !isModelDisabled(model));
	}, [selectedModels, isModelDisabled, hasAvailableWebservice]);

	const calculatableCount = useMemo(() => {
		return selectedModels.filter((model: Model) => !isModelDisabled(model)).length;
	}, [selectedModels, isModelDisabled]);

	const handleBulkCalculate = useCallback(async () => {
		const calculatableModels = selectedModels.filter((model: Model) => !isModelDisabled(model));
		const modelIds = calculatableModels.map((m) => m.id);
		await handleCalculate(modelIds);
		clearSelection();
	}, [selectedModels, isModelDisabled, handleCalculate, clearSelection]);
	const handleCalculateSingle = useCallback((model: Model) => {
		handleCalculate([model.id]);
	}, [handleCalculate]);

	const handleBulkCopy = useCallback(() => {
		if (document.activeElement instanceof HTMLElement) {
			document.activeElement.blur();
		}
		setBulkCopyModal({
			isOpen: true,
			models: [...selectedModels],
		});
	}, [selectedModels]);

	const deletableCount = useMemo(() => {
		return selectedModels.filter((model: Model) =>
			!isModelDisabled(model) && canUserDeleteModel(model)
		).length;
	}, [selectedModels, canUserDeleteModel, isModelDisabled]);

	const getMoveTooltip = useCallback(() => {
		const modelWord = selectedModels.length > 1 ? t('model.models').toLowerCase() : t('model.title').toLowerCase();
		if (canMoveAnySelected) {
			return `${t('model.move')} ${selectedModels.length} ${t('model.selected')} ${modelWord}`;
		}
		return t('model.cannotMove');
	}, [selectedModels.length, canMoveAnySelected, t]);

	const getCalculateTooltip = useCallback(() => {
		if (!hasAvailableWebservice) {
			return t('model.noWebserviceAvailable');
		}
		if (canCalculateAnySelected) {
			return `${t('model.calculate')} ${calculatableCount} ${t('model.selected')}`;
		}
		return t('model.cannotCalculate');
	}, [hasAvailableWebservice, canCalculateAnySelected, calculatableCount, t]);

	const getCopyTooltip = useCallback(() => {
		return `${t('model.copy')} ${selectedModels.length} ${t('model.selected')}`;
	}, [selectedModels.length, t]);

	const getDeleteTooltip = useCallback(() => {
		if (canDeleteAnySelected) {
			return `${t('model.delete')} ${deletableCount} ${t('model.selected')}`;
		}
		return t('model.cannotDelete');
	}, [canDeleteAnySelected, deletableCount, t]);

	const canCompareSelected = useMemo(() => {
		if (selectedModels.length !== 2) return false;
		const freshModels = modelsResponse?.data ?? [];
		return selectedModels.every((sel: Model) => {
			const fresh = freshModels.find((m: Model) => m.id === sel.id);
			return isModelCompleted(fresh ? fresh.status : sel.status);
		});
	}, [selectedModels, modelsResponse]);

	const handleCompareSelected = useCallback(() => {
		if (selectedModels.length !== 2) return;
		const [m1, m2] = selectedModels;
		navigate(`/app/simulation-reports?model1=${m1.id}&model2=${m2.id}`);
	}, [selectedModels, navigate]);

	const bulkActions: ActionConfig[] = useMemo(() => [
		{
			key: "bulk-move",
			icon: FolderInput,
			tooltip: getMoveTooltip(),
			variant: "secondary" as const,
			onClick: handleBulkMoveToWorkspace,
			disabled: !canMoveAnySelected,
		},
		{
			key: "bulk-copy",
			icon: Copy,
			tooltip: getCopyTooltip(),
			variant: "purple" as const,
			onClick: handleBulkCopy,
		},
		{
			key: "bulk-calculate",
			icon: Play,
			tooltip: getCalculateTooltip(),
			variant: "success" as const,
			onClick: handleBulkCalculate,
			disabled: !canCalculateAnySelected,
		},
		{
			key: "bulk-delete",
			icon: Trash2,
			tooltip: getDeleteTooltip(),
			variant: "danger" as const,
			onClick: showBulkDeleteConfirm,
			disabled: !canDeleteAnySelected,
		},
	], [getMoveTooltip, getCopyTooltip, getCalculateTooltip, getDeleteTooltip, handleBulkMoveToWorkspace, handleBulkCopy, handleBulkCalculate, showBulkDeleteConfirm, canMoveAnySelected, canCalculateAnySelected, canDeleteAnySelected, t]);

	return (
		<Fragment>
				<div className={`${PAGE_SHELL_CLASS} overflow-y-scroll`}>
				{/* Page header */}
				<PageHeader
					icon={BarChart3}
					title={t('model.dashboard')}
					subtitle={t('model.manageConfigurations')}
					actions={
						<Tooltip>
							<TooltipTrigger asChild>
								<span>
									<button
										onClick={handleNewModel}
										disabled={isModelLimitReached}
										data-tour="new-assessment"
										className={
											isModelLimitReached
												? 'inline-flex h-9 cursor-not-allowed items-center gap-2 rounded-lg bg-muted px-4 text-sm font-medium text-muted-foreground shadow-sm'
												: PRIMARY_BUTTON_CLASS
										}
									>
										{isModelLimitReached ? (
											<AlertCircle className="h-4 w-4" />
										) : (
											<Plus className="h-4 w-4" />
										)}
										{t('model.newModel')}
									</button>
								</span>
							</TooltipTrigger>
							{isModelLimitReached && (
								<TooltipContent>
									{t('model.limitReached', { current: stats.total, limit: stats.model_limit })}
								</TooltipContent>
							)}
						</Tooltip>
					}
				/>

				<div className="w-full space-y-5">
					{/* Groups Section */}
					{groups.length > 0 && (
						<div className="md-rise rounded-xl border border-border bg-card px-4 py-3.5 shadow-sm">
							<div className="flex items-center gap-2 mb-3">
								<Settings className="w-4 h-4 text-muted-foreground" />
								<h3 className="text-sm font-medium text-foreground">{t('model.modelGroups')}</h3>
							</div>
							<div className="flex gap-2 flex-wrap">
								<Chip
									label={t('model.allModels')}
									color={selectedGroup ? "default" : "primary"}
									variant={selectedGroup ? "outlined" : "filled"}
									onClick={() => setSelectedGroup(null)}
									size="small"
								/>
								{groups.map((group) => (
									<Chip
										key={group.id}
										label={`${group.name} (${group.ids.length})`}
										color={selectedGroup?.id === group.id ? "primary" : "default"}
										variant={selectedGroup?.id === group.id ? "filled" : "outlined"}
										onClick={() => setSelectedGroup(group)}
										size="small"
									/>
								))}
							</div>
						</div>
					)}

					{/* Main Content Card */}
					<div className={`md-rise ${CARD_CLASS}`} style={{ animationDelay: "60ms" }}>
						{/* Filter toolbar */}
						<div className="flex flex-wrap items-center gap-2 p-4 sm:px-5">
							{/* Search */}
							<div className="relative w-full sm:w-auto sm:min-w-[220px] sm:flex-1 sm:max-w-xs">
								<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
								<input
									type="text"
									placeholder={t('model.searchModels')}
									value={filterText}
									onChange={(e) => setFilterText(e.target.value)}
									className={SEARCH_INPUT_CLASS}
								/>
							</div>

								{/* Workspace Controls */}
								<div className="flex flex-wrap items-center gap-2">
									{isLoadingWorkspace ? (
										<div className="inline-flex h-9 items-center gap-2 rounded-lg border border-border bg-card px-3 text-sm shadow-sm">
											<RefreshCw className="h-4 w-4 animate-spin text-muted-foreground" />
											<span className="font-medium text-muted-foreground">{t('model.loadingWorkspace')}</span>
										</div>
									) : (
										<>
											<Tooltip>
												<TooltipTrigger asChild>
													<div>
														<WorkspaceSelector
															onWorkspaceChange={handleWorkspaceChange}
															onCreateWorkspace={() => setIsCreateWsOpen(true)}
															reloadKey={wsReloadKey}
															initialWorkspaceId={normalizedWorkspaceId ?? preferredWorkspaceId ?? undefined}
															activeWorkspace={currentWorkspace}
														/>
													</div>
												</TooltipTrigger>
												<TooltipContent>
													{t('model.selectWorkspace')}
												</TooltipContent>
											</Tooltip>

											<Tooltip>
												<TooltipTrigger asChild>
													<button
														onClick={handleRefresh}
														disabled={isRefreshing || isLoading}
														className={TOOLBAR_ICON_BUTTON_CLASS}
														aria-label={t('model.refreshModels')}
													>
														<RefreshCw className={`h-4 w-4 ${isRefreshing || isLoading ? 'animate-spin' : ''}`} />
													</button>
												</TooltipTrigger>
												<TooltipContent>
													{t('model.refreshModels')}
												</TooltipContent>
											</Tooltip>
										</>
									)}

									{/* Compare button - always visible */}
									<Tooltip>
										<TooltipTrigger asChild>
											<span className="inline-flex">
												<button
													onClick={handleCompareSelected}
													disabled={!canCompareSelected}
													className={TOOLBAR_BUTTON_CLASS}
												>
													<GitCompareArrows className="h-4 w-4 text-muted-foreground" />
													<span className="hidden sm:inline">{t('model.compare')}</span>
												</button>
											</span>
										</TooltipTrigger>
										<TooltipContent>
											<p>{canCompareSelected ? t('model.compare') : t('model.compareRequires2Completed')}</p>
										</TooltipContent>
									</Tooltip>

									{currentWorkspace && (
										<>
											{canManageWorkspace && (
												<Tooltip>
													<TooltipTrigger asChild>
														<button
															onClick={() => setIsShareWsOpen(true)}
															className={TOOLBAR_BUTTON_CLASS}
														>
															<Share className="w-4 h-4 text-muted-foreground" />
															<span className="hidden sm:inline">{t('model.share')}</span>
														</button>
													</TooltipTrigger>
													<TooltipContent>
														{t('model.shareWorkspace')}
													</TooltipContent>
												</Tooltip>
											)}

											<Tooltip>
												<TooltipTrigger asChild>
													<button
														onClick={() => setIsCopyWsOpen(true)}
														className={TOOLBAR_BUTTON_CLASS}
													>
														<Copy className="w-4 h-4 text-muted-foreground" />
														<span className="hidden sm:inline">{t('model.copy')}</span>
													</button>
												</TooltipTrigger>
												<TooltipContent>
													{t('model.copyWorkspace')}
												</TooltipContent>
											</Tooltip>

											{!currentWorkspace.is_default && canManageWorkspace && (
												<>
													<Tooltip>
														<TooltipTrigger asChild>
															<button
																onClick={() => setIsRenameWsOpen(true)}
																className={TOOLBAR_BUTTON_CLASS}
															>
																<Edit className="w-4 h-4 text-muted-foreground" />
																<span className="hidden sm:inline">{t('model.rename')}</span>
															</button>
														</TooltipTrigger>
														<TooltipContent>
															{t('model.renameWorkspace')}
														</TooltipContent>
													</Tooltip>

													<Tooltip>
														<TooltipTrigger asChild>
															<button
																onClick={handleDeleteWorkspace}
																className={DANGER_BUTTON_CLASS}
															>
																<Trash2 className="h-4 w-4" />
																<span className="hidden sm:inline">{t('model.delete')}</span>
															</button>
														</TooltipTrigger>
														<TooltipContent>
															{t('model.deleteWorkspace')}
														</TooltipContent>
													</Tooltip>
												</>
											)}
										</>
									)}

									{/* Bulk Actions - placed after workspace delete button */}
									{selectedModels.length > 0 && (
										<div className="md-fade-in flex h-9 items-center gap-2 rounded-full border border-border bg-muted/40 pl-1.5 pr-1.5 shadow-sm">
											<span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-primary px-1.5 text-xs font-semibold tabular-nums text-primary-foreground">
												{selectedModels.length}
											</span>
											<span className="hidden text-xs font-medium text-muted-foreground lg:inline">
												{t('model.selected')}
											</span>
											<span className="h-4 w-px bg-border" aria-hidden="true" />
											<ModelActionGroup
												actions={bulkActions}
												layout="horizontal"
												size="small"
											/>
										</div>
									)}
								</div>

								{/* Compact stats summary, in the toolbar */}
								{statsLoaded && (
									<ModelStatsSummary stats={stats} className="max-sm:w-full sm:ml-auto" />
								)}
							</div>

							{/* Table */}
							<div className="border-t border-border p-4 sm:px-5 sm:pb-5">
							{/* Table Section */}
							{(isLoading || isLoadingWorkspace) ? (
								<div className="space-y-3">
									<div className="flex items-center gap-2 text-sm text-muted-foreground">
										<RefreshCw className="h-4 w-4 animate-spin" />
										<span>
											{isLoadingWorkspace ? t('model.loadingWorkspace') : t('model.loadingModels')}
										</span>
									</div>
									<ListSkeleton />
									<p className="sr-only">
										{isLoadingWorkspace
											? t('model.loadingWorkspaceDescription')
											: t('model.loadingModelsDescription')}
									</p>
								</div>
							) : (
								<>
									{!isLoading && filteredModels.length > 0 ? (
										<div className="md-fade-in overflow-hidden rounded-xl border border-border">
									<div className="w-full overflow-auto">
										<table className="w-full table-auto">
											<thead>
												<tr className="border-b border-border bg-muted/40">
													<th className="w-12 px-4 py-2.5 text-center">
														<Tooltip>
															<TooltipTrigger asChild>
																<input
																	type="checkbox"
																	checked={
																		selectedModels.length === filteredModels.length && filteredModels.length > 0
																	}
																	onChange={() => handleSelectAll(filteredModels)}
																	className="h-4 w-4 cursor-pointer rounded border-input accent-primary focus:ring-ring focus:ring-offset-0"
																/>
															</TooltipTrigger>
															<TooltipContent>
																{selectedModels.length > 0 ? t('model.deselectAll') : t('model.selectAll')}
															</TooltipContent>
														</Tooltip>
													</th>
													<th className="px-4 py-2.5 text-left">
														<SortHeaderButton
															field="title"
															label={t('model.name')}
															orderBy={orderBy}
															order={order}
															onSort={handleSort}
														/>
													</th>
													<th className="px-4 py-2.5 text-left">
														<SortHeaderButton
															field="status"
															label={t('model.status')}
															orderBy={orderBy}
															order={order}
															onSort={handleSort}
														/>
													</th>
													<th className="hidden px-4 py-2.5 text-left md:table-cell">
														<SortHeaderButton
															field="created_at"
															label={t('model.created')}
															orderBy={orderBy}
															order={order}
															onSort={handleSort}
														/>
													</th>
													<th className="px-4 py-2.5 text-left">
														<span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t('model.actions')}</span>
													</th>
												</tr>
											</thead>
											<tbody className="divide-y divide-border bg-card">
												{paginatedModels.map((model, index) => (
													<ModelTableRow
														key={model.id}
														model={model}
														index={index}
														modelTitle={modelTitlesByID.get(model.id) ?? model.title.trim()}
														parentModelTitle={model.parent_model_id ? modelTitlesByID.get(model.parent_model_id) : undefined}
														hasChildren={(childCountByParentID.get(model.id) ?? 0) > 0}
														currentUserId={user?.id ? String(user.id) : undefined}
														userAccessLevel={user?.access_level}
														isSelected={isSelected(model)}
														isEditing={editingModel?.id === model.id}
														editTitle={editTitle}
														calculationStartTimes={calculationStartTimes}
														calculationCompletionInfo={calculationCompletionInfo}
														canUserDeleteModel={canUserDeleteModel}
														hasAvailableWebservice={hasAvailableWebservice}
														onSelect={handleSelectModel}
														onStartEdit={startTitleEdit}
														onEditTitleChange={setEditTitle}
														onUpdateTitle={updateTitle}
														onCancelEdit={cancelTitleEdit}
														onView={handleView}
														onEdit={handleEdit}
														onDownload={handleDownload}
														onCopy={handleCopy}
														onCalculate={handleCalculateSingle}
														onDelete={handleSingleDelete}
														onShare={handleShare}
														onMoveToWorkspace={handleMoveToWorkspace}
													/>
												))}
											</tbody>
										</table>
									</div>
									{sortedModels.length > 0 && (
										<Pagination
											currentPage={currentPage}
											totalItems={totalItems}
											itemsPerPage={itemsPerPage}
											onPageChange={handlePageChange}
											onItemsPerPageChange={handleItemsPerPageChange}
											pageSizeOptions={[5, 10, 25, 50]}
											isLoading={isLoading}
										/>
									)}
								</div>
							) : (
								<div className="md-fade-in flex flex-col items-center rounded-xl border border-dashed border-border bg-muted/30 px-6 py-14 text-center">
									<div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
										<BarChart3 className="h-7 w-7 text-muted-foreground" />
									</div>
									<h3 className="text-base font-semibold tracking-tight text-foreground">{t('model.noModelsFound')}</h3>
									<p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
										{filterText
											? t('model.noModelsMatch', { search: filterText })
											: t('model.noModelsYet')}
									</p>
									<Tooltip>
										<TooltipTrigger asChild>
											<span>
												<button
													onClick={handleNewModel}
													disabled={isModelLimitReached}
													className={`mt-6 ${
														isModelLimitReached
															? 'inline-flex h-9 cursor-not-allowed items-center gap-2 rounded-lg bg-muted px-4 text-sm font-medium text-muted-foreground shadow-sm'
															: PRIMARY_BUTTON_CLASS
													}`}
												>
													{isModelLimitReached ? (
														<AlertCircle className="h-4 w-4" />
													) : (
														<Plus className="h-4 w-4" />
													)}
													{t('model.createFirstModel')}
												</button>
											</span>
										</TooltipTrigger>
										{isModelLimitReached && (
											<TooltipContent>
												{t('model.limitReached', { current: stats.total, limit: stats.model_limit })}
											</TooltipContent>
										)}
									</Tooltip>
								</div>
							)}
							</>
							)}
						</div>
					</div>

						
					<CreateWorkspaceModal
						isOpen={isCreateWsOpen}
						onClose={() => setIsCreateWsOpen(false)}
						onSuccess={(newWorkspace) => {
							setIsCreateWsOpen(false);
							handleWorkspaceChange(newWorkspace);
							setWsReloadKey((k) => k + 1);
						}}
					/>
					<ShareWorkspaceModal
						isOpen={isShareWsOpen}
						workspace={currentWorkspace}
						onClose={() => setIsShareWsOpen(false)}
						onUpdated={() => setWsReloadKey((k) => k + 1)}
					/>
					<RenameWorkspaceModal
						isOpen={isRenameWsOpen}
						workspace={currentWorkspace}
						onClose={() => setIsRenameWsOpen(false)}
						onSuccess={handleRenameWorkspaceSuccess}
					/>
					<CopyWorkspaceModal
						isOpen={isCopyWsOpen}
						workspace={currentWorkspace}
						onClose={() => setIsCopyWsOpen(false)}
						onSuccess={handleCopyWorkspaceSuccess}
					/>


					<MoveModelModal
						isOpen={moveModelModal.isOpen}
						model={moveModelModal.model}
						models={moveModelModal.models}
						currentWorkspaceId={currentWorkspace?.id ?? null}
						onClose={() => setMoveModelModal({ isOpen: false, model: null })}
						onSuccess={async () => {
							clearSelection();
							await loadModels();
							await loadStats();
							setMoveModelModal({ isOpen: false, model: null });
						}}
					/>

				</div>
			</div>

			
			<ShareModelModal
				isOpen={shareModal.isOpen}
				model={shareModal.model}
				onClose={() => setShareModal({ isOpen: false, model: null })}
				onSuccess={() => { refetchModels(); }}
			/>

			<BulkCopyModal
				isOpen={bulkCopyModal.isOpen}
				models={bulkCopyModal.models}
				onClose={() => setBulkCopyModal({ isOpen: false, models: [] })}
				onCopy={handleCopy}
				onSuccess={() => {
					clearSelection();
				}}
			/>

			<Notification
				isOpen={notification.open}
				message={notification.message}
				severity={notification.severity}
				onClose={hideNotification}
			/>
		</Fragment>
	);
};
