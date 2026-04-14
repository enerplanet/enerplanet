import React, { memo } from "react";
import { Copy, FileEdit, Users, Clock, Star } from "lucide-react";
import { Model } from "@/features/model-dashboard/services/modelService";
import StatusBadge from "@/components/ui/StatusBadge";
import ElapsedTimer from "@/components/ui/ElapsedTimer";
import { SimulationProgress } from "@/components/ui/SimulationProgress";
import CompletedTimer from "@/components/ui/CompletedTimer";
import { Tooltip, TooltipTrigger, TooltipContent } from "@spatialhub/ui";
import ModelActions from "@/components/ui/ModelActions";
import { formatDateTime } from "@/utils/dateHelpers";
import { useTranslation } from "@spatialhub/i18n";
import { useFavoriteModelsStore } from "@/features/model-dashboard/store/favorite-models";

const getErrorMessage = (error: unknown): string => {
	if (typeof error === "string") return error;
	if (error && typeof error === "object") {
		if ("message" in error && typeof error.message === "string") {
			return error.message;
		}
		if ("error" in error && typeof error.error === "string") {
			return error.error;
		}
		return JSON.stringify(error);
	}
	return String(error);
};

type CompletionInfo = { startTime: string; endTime: string; totalSeconds: number };

interface ModelTableRowProps {
	model: Model & { level: number };
	modelTitle: string;
	parentModelTitle?: string;
	hasChildren: boolean;
	currentUserId?: string;
	userAccessLevel?: string;
	isSelected: boolean;
	isEditing: boolean;
	editTitle: string;
	calculationStartTimes: Record<number, string>;
	calculationCompletionInfo: Record<number, CompletionInfo>;
	canUserDeleteModel: (model: Model) => boolean;
	hasAvailableWebservice: boolean;
	onSelect: (model: Model) => void;
	onStartEdit: (model: Model) => void;
	onEditTitleChange: (value: string) => void;
	onUpdateTitle: () => void;
	onCancelEdit: () => void;
	onView: (model: Model) => void;
	onEdit: (model: Model) => void;
	onDownload: (model: Model) => void;
	onCopy: (model: Model) => void;
	onCalculate: (model: Model) => void;
	onDelete: (model: Model) => void;
	onShare: (model: Model) => void;
	onMoveToWorkspace: (model: Model) => void;
}

interface ModelNameCellProps {
	isEditing: boolean;
	editTitle: string;
	modelTitle: string;
	parentModelTitle?: string;
	onEditTitleChange: (value: string) => void;
	onUpdateTitle: () => void;
	onCancelEdit: () => void;
	onStartEdit: () => void;
	level: number;
	model: Model;
	isNotModelOwner: boolean | "" | 0 | null | undefined;
	isParent: boolean;
	hasChildren: boolean;
}

const ModelNameCell: React.FC<ModelNameCellProps> = ({
	isEditing,
	editTitle,
	modelTitle,
	parentModelTitle,
	onEditTitleChange,
	onUpdateTitle,
	onCancelEdit,
	onStartEdit,
	level,
	model,
	isNotModelOwner,
	isParent,
	hasChildren,
}) => {
	const { t } = useTranslation();

	if (isEditing) {
		return (
			<input
				type="text"
				value={editTitle}
				onChange={(e) => onEditTitleChange(e.target.value)}
				onBlur={onUpdateTitle}
				onKeyDown={(e) => {
					if (e.key === "Enter") onUpdateTitle();
					if (e.key === "Escape") onCancelEdit();
				}}
				autoFocus
				className="min-w-40 px-3 py-1.5 border border-input rounded-lg focus:ring-2 focus:ring-ring focus:border-transparent bg-background text-sm text-foreground"
			/>
		);
	}

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<button
					onClick={onStartEdit}
					className="flex items-center gap-2 py-1.5 px-2.5 rounded-lg hover:bg-muted transition-colors group/title max-w-[240px]"
				>
					{level > 0 && (
						<div className="flex items-center mr-0.5">
							<div className="w-3 h-3 border-l border-b border-muted-foreground rounded-bl-sm"></div>
						</div>
					)}

					<div className="flex items-center gap-1.5">
						{model.is_copy && (
							<Tooltip>
								<TooltipTrigger asChild>
									<span className="flex items-center justify-center w-5 h-5 bg-muted rounded">
										<Copy className="w-3 h-3 text-muted-foreground" />
									</span>
								</TooltipTrigger>
								<TooltipContent>{t("model.copyOf", { name: parentModelTitle || t("model.anotherModel") })}</TooltipContent>
							</Tooltip>
						)}
						{isNotModelOwner && (
							<Tooltip>
								<TooltipTrigger asChild>
									<span className="flex items-center justify-center w-5 h-5 bg-muted rounded">
										<Users className="w-3 h-3 text-muted-foreground" />
									</span>
								</TooltipTrigger>
								<TooltipContent>
									{t("model.ownedBy")}: {model.user_email || t("common.unknown")}
								</TooltipContent>
							</Tooltip>
						)}
						{isParent && hasChildren && (
							<Tooltip>
								<TooltipTrigger asChild>
									<span className="flex items-center justify-center w-5 h-5 bg-muted rounded text-xs font-semibold text-foreground">
										P
									</span>
								</TooltipTrigger>
								<TooltipContent>{t("model.parentModel")}</TooltipContent>
							</Tooltip>
						)}
					</div>

					<span className="font-medium text-sm text-foreground truncate">
						{modelTitle}
					</span>

					<FileEdit className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover/title:opacity-100 transition-opacity flex-shrink-0" />
				</button>
			</TooltipTrigger>
			<TooltipContent>{t("common.tooltips.editName")}</TooltipContent>
		</Tooltip>
	);
};

const ModelTableRowBase: React.FC<ModelTableRowProps> = ({
	model,
	modelTitle,
	parentModelTitle,
	hasChildren,
	currentUserId,
	userAccessLevel,
	isSelected,
	isEditing,
	editTitle,
	calculationStartTimes,
	calculationCompletionInfo,
	canUserDeleteModel,
	hasAvailableWebservice,
	onSelect,
	onStartEdit,
	onEditTitleChange,
	onUpdateTitle,
	onCancelEdit,
	onView,
	onEdit,
	onDownload,
	onCopy,
	onCalculate,
	onDelete,
	onShare,
	onMoveToWorkspace,
}) => {
	const { t } = useTranslation();
	const toggleFavorite = useFavoriteModelsStore((s) => s.toggleFavorite);
	const isFavorite = useFavoriteModelsStore((s) => s.isFavorite);
	const favorited = isFavorite(model.id);
	const isParent = !model.is_copy && !model.parent_model_id;
	const level = model.level || 0;
	const indentClass = level > 0 ? "pl-8" : "";
	const canManageModel = canUserDeleteModel(model);

	const isNotModelOwner = currentUserId && model.user_id &&
		String(model.user_id) !== String(currentUserId);

	const rowClassName = `group hover:bg-muted/50 transition-all duration-150 ${
		level > 0 ? "border-l-2 border-border bg-muted/30" : ""
	} ${isSelected ? "bg-muted" : ""}`;

	return (
		<tr className={rowClassName}>
			<td className={`pl-4 pr-2 py-3 ${indentClass}`}>
				<div className="flex items-center justify-center gap-1.5">
					<input
						type="checkbox"
						checked={isSelected}
						onChange={() => onSelect(model)}
						className="w-4 h-4 text-foreground rounded border-input focus:ring-ring focus:ring-offset-0 cursor-pointer"
					/>
					<button
						type="button"
						onClick={(e) => { e.stopPropagation(); toggleFavorite(model.id); }}
						className="p-0.5 rounded hover:bg-muted transition-colors"
						aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
					>
						<Star className={`w-3.5 h-3.5 ${favorited ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
					</button>
				</div>
			</td>

			<td className={`pl-2 pr-4 py-3 ${indentClass}`}>
				<div className="flex items-center gap-2">
					<ModelNameCell
						isEditing={isEditing}
						editTitle={editTitle}
						modelTitle={modelTitle}
						parentModelTitle={parentModelTitle}
						onEditTitleChange={onEditTitleChange}
						onUpdateTitle={onUpdateTitle}
						onCancelEdit={onCancelEdit}
						onStartEdit={() => onStartEdit(model)}
						level={level}
						model={model}
						isNotModelOwner={isNotModelOwner}
						isParent={isParent}
						hasChildren={hasChildren}
					/>
				</div>
			</td>

			<td className="px-4 py-3">
				<div className="flex items-center gap-2">
					{model.status === "failed" ? (
						<Tooltip>
							<TooltipTrigger asChild>
								<div>
									<StatusBadge status={model.status} size="small" />
								</div>
							</TooltipTrigger>
							<TooltipContent>
								{model.results?.error
									? `${t("model.failed")}: ${getErrorMessage(model.results.error)}`
									: t("model.failedDefaultMessage")}
							</TooltipContent>
						</Tooltip>
					) : (
						<StatusBadge status={model.status} size="small" />
					)}

					{model.status === "running" && calculationStartTimes[model.id] && (
						<div className="flex items-center gap-1 px-2 py-1 bg-muted rounded-md">
							<ElapsedTimer
								startTime={calculationStartTimes[model.id]}
								isRunning={true}
								className="text-xs font-medium text-foreground"
								showBlinkingIcon={true}
							/>
						</div>
					)}

					{model.status === "queue" && (
						<Tooltip>
							<TooltipTrigger asChild>
								<div className="relative flex items-center justify-center w-6 h-6 cursor-pointer">
									<span className="absolute w-5 h-5 bg-amber-100 dark:bg-amber-900/30 rounded-full"></span>
									<span className="absolute w-5 h-5 bg-amber-300 dark:bg-amber-600 rounded-full animate-ping opacity-50"></span>
									<Clock className="relative w-3 h-3 text-amber-600 dark:text-amber-400" />
								</div>
							</TooltipTrigger>
							<TooltipContent>
								<p>{t("model.queuedTooltip")}</p>
							</TooltipContent>
						</Tooltip>
					)}

					{(model.status === "queue" || model.status === "calculating" || model.status === "running" || model.status === "processing") && (
						<SimulationProgress status={model.status} />
					)}

					{(model.status === "completed" || model.status === "failed" || model.status === "cancelled") &&
						calculationCompletionInfo[model.id] && (
							<CompletedTimer
								totalSeconds={calculationCompletionInfo[model.id].totalSeconds}
								status={model.status}
							/>
						)}
				</div>
			</td>

			<td className="px-4 py-3">
				<div className="flex items-center gap-1.5 text-muted-foreground">
					<Clock className="w-3.5 h-3.5" />
					<span className="text-xs font-medium">{formatDateTime(model.created_at)}</span>
				</div>
			</td>

			<td className="px-4 py-3">
				<div className="flex items-center gap-1">
					<ModelActions
						model={model}
						currentUserId={currentUserId}
						userAccessLevel={userAccessLevel}
						onView={onView}
						onEdit={onEdit}
						onDownload={onDownload}
						onCopy={onCopy}
						onCalculate={onCalculate}
						onDelete={onDelete}
						onShare={onShare}
						onMoveToWorkspace={onMoveToWorkspace}
						disableDelete={!canManageModel}
						deleteTooltip={
							canManageModel
								? t("common.delete")
								: t("model.sharedCannotDelete")
						}
						disableMoveToWorkspace={!canManageModel}
						moveToWorkspaceTooltip={
							canManageModel
								? t("common.tooltips.moveToWorkspace")
								: t("model.sharedCannotMove")
						}
						disableShare={!canManageModel}
						shareTooltip={
							canManageModel
								? t("common.tooltips.share")
								: t("model.sharedCannotShare")
						}
						hasAvailableWebservice={hasAvailableWebservice}
						layout="horizontal"
						size="small"
					/>
				</div>
			</td>
		</tr>
	);
};

const completionInfoEqual = (prev?: CompletionInfo, next?: CompletionInfo): boolean => {
	if (!prev && !next) return true;
	if (!prev || !next) return false;
	return prev.startTime === next.startTime &&
		prev.endTime === next.endTime &&
		prev.totalSeconds === next.totalSeconds;
};

const modelSnapshotEqual = (prev: Model & { level: number }, next: Model & { level: number }): boolean =>
	prev.id === next.id &&
	prev.title === next.title &&
	prev.status === next.status &&
	prev.created_at === next.created_at &&
	prev.updated_at === next.updated_at &&
	prev.user_id === next.user_id &&
	prev.user_email === next.user_email &&
	prev.is_copy === next.is_copy &&
	prev.parent_model_id === next.parent_model_id &&
	prev.level === next.level &&
	getErrorMessage(prev.results?.error) === getErrorMessage(next.results?.error);

const areRowPropsEqual = (prev: ModelTableRowProps, next: ModelTableRowProps): boolean => {
	if (!modelSnapshotEqual(prev.model, next.model)) return false;

	if (prev.modelTitle !== next.modelTitle) return false;
	if (prev.parentModelTitle !== next.parentModelTitle) return false;
	if (prev.hasChildren !== next.hasChildren) return false;
	if (prev.currentUserId !== next.currentUserId) return false;
	if (prev.userAccessLevel !== next.userAccessLevel) return false;
	if (prev.isSelected !== next.isSelected) return false;
	if (prev.isEditing !== next.isEditing) return false;
	if (prev.editTitle !== next.editTitle) return false;
	if (prev.hasAvailableWebservice !== next.hasAvailableWebservice) return false;
	if (prev.canUserDeleteModel(prev.model) !== next.canUserDeleteModel(next.model)) return false;

	const modelID = prev.model.id;
	if ((prev.calculationStartTimes[modelID] ?? "") !== (next.calculationStartTimes[modelID] ?? "")) return false;
	if (!completionInfoEqual(prev.calculationCompletionInfo[modelID], next.calculationCompletionInfo[modelID])) return false;

	return true;
};

export const ModelTableRow = memo(ModelTableRowBase, areRowPropsEqual);
