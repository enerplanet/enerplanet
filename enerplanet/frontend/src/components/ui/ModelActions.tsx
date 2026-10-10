import { Eye, Edit, Download, Copy, Trash2, Share, FolderInput, Zap, Activity } from "lucide-react";
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
	readonly onRunMeme?: (model: T) => void;
	readonly onRunMemePypsa?: (model: T) => void;
	readonly onDelete?: (model: T) => void;
	readonly onShare?: (model: T) => void;
	readonly onMoveToWorkspace?: (model: T) => void;
	readonly showView?: boolean;
	readonly showEdit?: boolean;
	readonly showDownload?: boolean;
	readonly showCopy?: boolean;
	readonly showDelete?: boolean;
	readonly showShare?: boolean;
	readonly showMoveToWorkspace?: boolean;
	readonly disableDelete?: boolean;
	readonly deleteTooltip?: string;
	readonly disableMoveToWorkspace?: boolean;
	readonly moveToWorkspaceTooltip?: string;
	readonly disableShare?: boolean;
	readonly shareTooltip?: string;
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
	onRunMeme,
	onRunMemePypsa,
	onDelete,
	onShare,
	onMoveToWorkspace,
	showView = true,
	showEdit = true,
	showDownload = true,
	showCopy = true,
	showDelete = true,
	showShare = true,
	showMoveToWorkspace = true,
	disableDelete = false,
	deleteTooltip,
	disableMoveToWorkspace = false,
	moveToWorkspaceTooltip,
	disableShare = false,
	shareTooltip,
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
			onView, onEdit, onDownload, onCopy, onRunMeme, onRunMemePypsa, onDelete, onShare, onMoveToWorkspace,
			showView, showEdit, showDownload, showCopy, showDelete, showShare, showMoveToWorkspace,
			disableMoveToWorkspace, moveToWorkspaceTooltip, disableShare, shareTooltip
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
		"onView" | "onEdit" | "onDownload" | "onCopy" | "onRunMeme" | "onRunMemePypsa" | "onDelete" | "onShare" | "onMoveToWorkspace" |
		"showView" | "showEdit" | "showDownload" | "showCopy" | "showDelete" | "showShare" | "showMoveToWorkspace" |
		"disableMoveToWorkspace" | "moveToWorkspaceTooltip" | "disableShare" | "shareTooltip"
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
		onView, onEdit, onDownload, onCopy, onRunMeme, onRunMemePypsa, onDelete, onShare, onMoveToWorkspace,
		showView, showEdit, showDownload, showCopy, showDelete, showShare, showMoveToWorkspace,
		disableMoveToWorkspace, moveToWorkspaceTooltip, disableShare, shareTooltip
	} = props;
	const { disabled, completed, shouldDisableDelete, deleteTooltipText } = computed;

	return [
		{
			// The only run trigger: MEME dispatch over TentaCron. The legacy
			// webservice run was removed so a model can never be sent down the
			// retired power-flow path by accident; POST /models/:id/run-meme is
			// the seam.
			key: "runMeme",
			icon: Zap,
			tooltip: t("common.modelActions.runWithMeme"),
			variant: "warning",
			onClick: () => onRunMeme?.(model),
			show: !!onRunMeme &&
				(model.status === 'draft' || model.status === 'modified' || model.status === 'failed'),
			disabled,
		},
		{
			// Isolated PyPSA power-flow leg: an ADD-ON to a successful Calliope
			// run (the derived pass reads the Calliope results), so it shows
			// only on completed models — mirroring view/download. The backend
			// also enforces this gate (400 on run-meme-pypsa without one).
			key: "runMemePypsa",
			icon: Activity,
			tooltip: t("common.modelActions.runPypsaOnMeme"),
			variant: "secondary",
			onClick: () => onRunMemePypsa?.(model),
			show: !!onRunMemePypsa && completed,
			disabled,
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
