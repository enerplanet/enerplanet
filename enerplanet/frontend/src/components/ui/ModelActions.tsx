import { Eye, Edit, Download, Copy, Play, Trash2, Share, FolderInput, RefreshCw } from "lucide-react";
import { ModelStatus } from "@/types/models";
import { isModelDisabled, isModelCompleted } from "@/features/model-dashboard/utils/statusHelpers";
import ModelActionGroup, { ActionConfig, ActionSize } from "../shared/ModelActionGroup";
import { useTranslation } from "@spatialhub/i18n";

interface ModelActionsProps<T extends { id: number; status: ModelStatus; user_id?: string }> {
	readonly model: T;
	readonly currentUserId?: string;
	readonly userAccessLevel?: string;
	readonly onView?: (model: T) => void;
	readonly onEdit?: (model: T) => void;
	readonly onDownload?: (model: T) => void;
	readonly onCopy?: (model: T) => void;
	readonly onCalculate?: (model: T) => void;
	readonly onDelete?: (model: T) => void;
	readonly onShare?: (model: T) => void;
	readonly onMoveToWorkspace?: (model: T) => void;
	readonly showView?: boolean;
	readonly showEdit?: boolean;
	readonly showDownload?: boolean;
	readonly showCopy?: boolean;
	readonly showCalculate?: boolean;
	readonly showDelete?: boolean;
	readonly showShare?: boolean;
	readonly showMoveToWorkspace?: boolean;
	readonly disableDelete?: boolean;
	readonly deleteTooltip?: string;
	readonly disableMoveToWorkspace?: boolean;
	readonly moveToWorkspaceTooltip?: string;
	readonly disableShare?: boolean;
	readonly shareTooltip?: string;
	readonly hasAvailableWebservice?: boolean;
	readonly layout?: "horizontal" | "grid";
	readonly size?: ActionSize;
}

function ModelActions<T extends { id: number; status: ModelStatus; user_id?: string }>({
	model,
	currentUserId,
	userAccessLevel,
	onView,
	onEdit,
	onDownload,
	onCopy,
	onCalculate,
	onDelete,
	onShare,
	onMoveToWorkspace,
	showView = true,
	showEdit = true,
	showDownload = true,
	showCopy = true,
	showCalculate = true,
	showDelete = true,
	showShare = true,
	showMoveToWorkspace = true,
	disableDelete = false,
	deleteTooltip,
	disableMoveToWorkspace = false,
	moveToWorkspaceTooltip,
	disableShare = false,
	shareTooltip,
	hasAvailableWebservice = true,
	layout = "horizontal",
	size = "small",
}: ModelActionsProps<T>) {
	const { t } = useTranslation();
	const disabled = isModelDisabled(model.status);
	const completed = isModelCompleted(model.status);
	
	const isOwner = currentUserId && 'user_id' in model &&
		String(model.user_id) === String(currentUserId);

	const isExpert = userAccessLevel === 'expert';

	const canDelete = isOwner || isExpert;
	const shouldDisableDelete = disableDelete || !canDelete;

	let deleteTooltipText = deleteTooltip || t("common.modelActions.delete");
	if (!canDelete) {
		deleteTooltipText = t("common.modelActions.cannotDelete");
	}

	const actions: ActionConfig[] = getActionConfigs(
		model,
		{
			onView, onEdit, onDownload, onCopy, onCalculate, onDelete, onShare, onMoveToWorkspace,
			showView, showEdit, showDownload, showCopy, showCalculate, showDelete, showShare, showMoveToWorkspace,
			disableMoveToWorkspace, moveToWorkspaceTooltip, disableShare, shareTooltip, hasAvailableWebservice
		},
		{ disabled, completed, shouldDisableDelete, deleteTooltipText },
		t
	);

	return <ModelActionGroup actions={actions} layout={layout} size={size} />;
}

// Helper to get tooltip with fallback for disabled state
const getTooltip = (defaultText: string, disabled: boolean, disabledText?: string): string =>
	disabled && disabledText ? disabledText : defaultText;

function getActionConfigs<T extends { id: number; status: ModelStatus; user_id?: string }>(
	model: T,
	props: Pick<ModelActionsProps<T>, 
		"onView" | "onEdit" | "onDownload" | "onCopy" | "onCalculate" | "onDelete" | "onShare" | "onMoveToWorkspace" |
		"showView" | "showEdit" | "showDownload" | "showCopy" | "showCalculate" | "showDelete" | "showShare" | "showMoveToWorkspace" |
		"disableMoveToWorkspace" | "moveToWorkspaceTooltip" | "disableShare" | "shareTooltip" | "hasAvailableWebservice"
	>,
	computed: {
		disabled: boolean;
		completed: boolean;
		shouldDisableDelete: boolean;
		deleteTooltipText: string;
	},
	t: (key: string) => string
): ActionConfig[] {
	const {
		onView, onEdit, onDownload, onCopy, onCalculate, onDelete, onShare, onMoveToWorkspace,
		showView, showEdit, showDownload, showCopy, showCalculate, showDelete, showShare, showMoveToWorkspace,
		disableMoveToWorkspace, moveToWorkspaceTooltip, disableShare, shareTooltip, hasAvailableWebservice = true
	} = props;
	const { disabled, completed, shouldDisableDelete, deleteTooltipText } = computed;

	// Helper to get webservice tooltip with translation
	const getWebserviceTooltip = (action: string, available: boolean): string =>
		available ? action : t("common.modelActions.engineNotAvailable");

	return [
		{
			key: "retry",
			icon: RefreshCw,
			tooltip: getWebserviceTooltip(t("common.modelActions.retryCalculation"), hasAvailableWebservice),
			variant: "warning",
			onClick: () => onCalculate?.(model),
			show: showCalculate && !!onCalculate && model.status === 'failed',
			disabled: disabled || !hasAvailableWebservice,
		},
		{
			key: "calculate",
			icon: Play,
			tooltip: getWebserviceTooltip(t("common.modelActions.startCalculation"), hasAvailableWebservice),
			variant: "success",
			onClick: () => onCalculate?.(model),
			show: showCalculate && !!onCalculate && (model.status === 'draft' || model.status === 'modified'),
			disabled: disabled || !hasAvailableWebservice,
		},
		{
			key: "view",
			icon: Eye,
			tooltip: t("common.modelActions.viewResults"),
			variant: "info",
			onClick: () => onView?.(model),
			show: showView && !!onView && completed,
			disabled: false,
		},
		{
			key: "download",
			icon: Download,
			tooltip: t("common.modelActions.downloadResults"),
			variant: "info",
			onClick: () => onDownload?.(model),
			show: showDownload && !!onDownload && completed,
			disabled: false,
		},
		{
			key: "copy",
			icon: Copy,
			tooltip: t("common.modelActions.copyConfiguration"),
			variant: "purple",
			onClick: () => onCopy?.(model),
			show: showCopy && !!onCopy,
			disabled: false,
		},
		{
			key: "edit",
			icon: Edit,
			tooltip: completed ? t("common.modelActions.cannotEditCompleted") : t("common.modelActions.editConfiguration"),
			variant: "default",
			onClick: () => onEdit?.(model),
			show: showEdit && !!onEdit,
			disabled: disabled || completed,
		},
		{
			key: "moveToWorkspace",
			icon: FolderInput,
			tooltip: getTooltip(t("common.modelActions.moveToWorkspace"), !!disableMoveToWorkspace, moveToWorkspaceTooltip),
			variant: "secondary",
			onClick: () => onMoveToWorkspace?.(model),
			show: showMoveToWorkspace && !!onMoveToWorkspace,
			disabled: disabled || !!disableMoveToWorkspace,
		},
		{
			key: "share",
			icon: Share,
			tooltip: getTooltip(t("common.modelActions.shareModel"), !!disableShare, shareTooltip),
			variant: "secondary",
			onClick: () => onShare?.(model),
			show: showShare && !!onShare,
			disabled: disabled || !!disableShare,
		},
		{
			key: "delete",
			icon: Trash2,
			tooltip: deleteTooltipText,
			variant: "danger",
			onClick: () => onDelete?.(model),
			show: showDelete && !!onDelete,
			disabled: shouldDisableDelete,
		},
	];
}

export default ModelActions;
