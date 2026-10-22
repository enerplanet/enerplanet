import React, { memo } from "react";
import { FileEdit, Users, Clock, Star, AlertTriangle, Flag, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";
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
import { failedStageLabel, failureMessage } from "@/features/model-dashboard/utils/failureMessage";
import { RUN_REPORT_STATE_KEY, type RunReportTarget } from "@/features/user-feedback/runReport";

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

// Set by dispatch_meme when some buildings ran without a BuEM series.
const getDemandFallback = (results: Model["results"]): { fallback: number; total: number } | null => {
  const warning = results?.warning as { code?: string; fallback?: number; total?: number } | undefined;
  if (warning?.code !== "demand_fallback") return null;
  return { fallback: warning.fallback ?? 0, total: warning.total ?? 0 };
};

type CompletionInfo = { startTime: string; endTime: string; totalSeconds: number };

interface ModelTableRowProps {
  model: Model & { level: number };
  index: number;
  modelTitle: string;
  /** Copies of this original on the page; 0 for a copy or an original without copies. */
  copyCount: number;
  /** Failed copies among them, shown while the family is collapsed. */
  failedCopyCount: number;
  familyCollapsed: boolean;
  onToggleFamily: (modelId: number) => void;
  currentUserId?: string;
  userAccessLevel?: string;
  isSelected: boolean;
  isEditing: boolean;
  editTitle: string;
  calculationStartTimes: Record<number, string>;
  calculationCompletionInfo: Record<number, CompletionInfo>;
  canUserDeleteModel: (model: Model) => boolean;
  onSelect: (model: Model) => void;
  onStartEdit: (model: Model) => void;
  onEditTitleChange: (value: string) => void;
  onUpdateTitle: () => void;
  onCancelEdit: () => void;
  onView: (model: Model) => void;
  onEdit: (model: Model) => void;
  onDownload: (model: Model) => void;
  onCopy: (model: Model) => void;
  onRunMeme: (model: Model) => void;
  // Not passed while the PyPSA leg is withheld; ModelActions hides it then.
  onRunMemePypsa?: (model: Model) => void;
  onDelete: (model: Model) => void;
  onShare: (model: Model) => void;
  onMoveToWorkspace: (model: Model) => void;
}

interface ModelNameCellProps {
  isEditing: boolean;
  editTitle: string;
  modelTitle: string;
  onEditTitleChange: (value: string) => void;
  onUpdateTitle: () => void;
  onCancelEdit: () => void;
  onStartEdit: () => void;
  level: number;
  model: Model;
  isNotModelOwner: boolean | "" | 0 | null | undefined;
}

const ModelNameCell: React.FC<ModelNameCellProps> = ({
  isEditing,
  editTitle,
  modelTitle,
  onEditTitleChange,
  onUpdateTitle,
  onCancelEdit,
  onStartEdit,
  level,
  model,
  isNotModelOwner,
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
          className="flex items-center gap-2 py-1.5 px-2.5 rounded-lg hover:bg-muted transition-colors group/title max-w-[360px] text-left"
        >
          {level > 0 && (
            <div className="flex items-center mr-0.5">
              <div className="-mt-2 h-3.5 w-3.5 rounded-bl-[3px] border-b-2 border-l-2 border-slate-400 dark:border-slate-500" aria-hidden="true"></div>
            </div>
          )}

          <div className="flex items-center gap-1.5">
            {isNotModelOwner && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="flex items-center justify-center w-5 h-5 bg-muted rounded-md">
                    <Users className="w-3 h-3 text-muted-foreground" />
                  </span>
                </TooltipTrigger>
                <TooltipContent>
                  {t("model.ownedBy")}: {model.user_email || t("common.unknown")}
                </TooltipContent>
              </Tooltip>
            )}
          </div>

          <span className="font-medium text-sm text-foreground line-clamp-2 break-words">{modelTitle}</span>

          <FileEdit className="w-3.5 h-3.5 text-muted-foreground opacity-0 group-hover/title:opacity-100 transition-opacity flex-shrink-0" />
        </button>
      </TooltipTrigger>
      <TooltipContent>{t("common.tooltips.editName")}</TooltipContent>
    </Tooltip>
  );
};

/** A failed run's tooltip: stage, the service that failed and the next step. */
const FailureTooltip: React.FC<{ results: Model["results"] }> = ({ results }) => {
  const { t } = useTranslation();
  const msg = failureMessage(results, t);
  return (
    <div className="flex flex-col gap-1.5 text-[13px] leading-snug">
      <strong>{msg.title}</strong>
      <span>{msg.body}</span>
      {msg.next && <span className="opacity-80">{msg.next}</span>}
    </div>
  );
};

/** Opens the feedback form as a bug report about this failed run. */
const ReportFailureButton: React.FC<{ model: Model }> = ({ model }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const stage = model.results?.failed_stage;
  const target: RunReportTarget = { id: model.id, title: model.title, stage: typeof stage === "string" ? stage : undefined };
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        navigate("/app/feedback", { state: { [RUN_REPORT_STATE_KEY]: target } });
      }}
      className="inline-flex h-7 items-center gap-1 rounded-md border border-red-200 bg-background px-2 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/40"
    >
      <Flag className="h-3.5 w-3.5" aria-hidden="true" />
      {t("model.failure.report")}
    </button>
  );
};

/** Shows or hides an original's copies; a blank of the same width for an original without copies. */
const FamilyToggle: React.FC<{ modelId: number; title: string; copyCount: number; collapsed: boolean; onToggle: (modelId: number) => void }> = ({
  modelId,
  title,
  copyCount,
  collapsed,
  onToggle,
}) => {
  const { t } = useTranslation();
  if (copyCount === 0) return <span className="w-8 flex-shrink-0" aria-hidden="true" />;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onToggle(modelId);
      }}
      aria-expanded={!collapsed}
      aria-label={t(collapsed ? "model.family.show" : "model.family.hide", { name: title })}
      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg border border-border bg-background transition-colors hover:bg-muted"
    >
      <ChevronRight className={`h-4 w-4 text-foreground transition-transform ${collapsed ? "" : "rotate-90"}`} aria-hidden="true" />
    </button>
  );
};

/** An original's copy count, and while its copies are hidden, how many of them failed. */
const FamilyCounts: React.FC<{ copyCount: number; failedCopyCount: number; collapsed: boolean }> = ({ copyCount, failedCopyCount, collapsed }) => {
  const { t } = useTranslation();
  if (copyCount === 0) return null;
  return (
    <>
      <span className="whitespace-nowrap rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-800 dark:bg-slate-700 dark:text-slate-100">
        {t("model.family.copies", { count: copyCount })}
      </span>
      {collapsed && failedCopyCount > 0 && (
        <span className="whitespace-nowrap rounded-full bg-red-100 px-2.5 py-0.5 text-xs font-medium text-red-800 dark:bg-red-950/50 dark:text-red-300">
          {t("model.family.failed", { count: failedCopyCount })}
        </span>
      )}
    </>
  );
};

const ModelTableRowBase: React.FC<ModelTableRowProps> = ({
  model,
  index,
  modelTitle,
  copyCount,
  failedCopyCount,
  familyCollapsed,
  onToggleFamily,
  currentUserId,
  userAccessLevel,
  isSelected,
  isEditing,
  editTitle,
  calculationStartTimes,
  calculationCompletionInfo,
  canUserDeleteModel,
  onSelect,
  onStartEdit,
  onEditTitleChange,
  onUpdateTitle,
  onCancelEdit,
  onView,
  onEdit,
  onDownload,
  onCopy,
  onRunMeme,
  onRunMemePypsa,
  onDelete,
  onShare,
  onMoveToWorkspace,
}) => {
  const { t } = useTranslation();
  const toggleFavorite = useFavoriteModelsStore((s) => s.toggleFavorite);
  const isFavorite = useFavoriteModelsStore((s) => s.isFavorite);
  const favorited = isFavorite(model.id);
  const level = model.level || 0;
  // Copies sit in their family's block (ModelDashboard); only the name is indented.
  const nameIndentClass = level > 0 ? "pl-6" : "";
  const canManageModel = canUserDeleteModel(model);

  const isNotModelOwner =
    currentUserId && model.user_id && String(model.user_id) !== String(currentUserId);

  const rowClassName = `md-row-in group transition-colors duration-150 hover:bg-muted/40 ${
    isSelected ? "bg-muted/60 shadow-[inset_2px_0_0_0_var(--primary)]" : ""
  }`;

  return (
    <tr className={rowClassName} style={{ animationDelay: `${Math.min(index * 30, 240)}ms` }}>
      <td className="w-24 pl-4 pr-2 py-2.5">
        <div className="flex items-center justify-center gap-1.5">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => onSelect(model)}
            className="h-4 w-4 cursor-pointer rounded border-input accent-primary focus:ring-ring focus:ring-offset-0"
          />
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleFavorite(model.id);
            }}
            className="rounded-md p-1 transition-all duration-150 hover:bg-muted hover:scale-110 active:scale-95"
            aria-label={favorited ? "Remove from favorites" : "Add to favorites"}
          >
            <Star
              className={`h-3.5 w-3.5 transition-colors ${favorited ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`}
            />
          </button>
        </div>
      </td>

      <td className={`w-[38%] pl-2 pr-4 py-2.5 ${nameIndentClass}`}>
        <div className="flex items-center gap-2">
          {level === 0 && (
            <FamilyToggle modelId={model.id} title={modelTitle} copyCount={copyCount} collapsed={familyCollapsed} onToggle={onToggleFamily} />
          )}
          <ModelNameCell
            isEditing={isEditing}
            editTitle={editTitle}
            modelTitle={modelTitle}
            onEditTitleChange={onEditTitleChange}
            onUpdateTitle={onUpdateTitle}
            onCancelEdit={onCancelEdit}
            onStartEdit={() => onStartEdit(model)}
            level={level}
            model={model}
            isNotModelOwner={isNotModelOwner}
          />
          <FamilyCounts copyCount={copyCount} failedCopyCount={failedCopyCount} collapsed={familyCollapsed} />
        </div>
      </td>

      <td className="w-[24%] px-4 py-2.5">
        <div className="flex items-center gap-2">
          {model.status === "failed" ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <div>
                  <StatusBadge status={model.status} size="small" showIcon={false} label={failedStageLabel(model.results?.failed_stage, t)} />
                </div>
              </TooltipTrigger>
              <TooltipContent className="w-[340px] whitespace-normal">
                <FailureTooltip results={model.results} />
              </TooltipContent>
            </Tooltip>
          ) : (
            <StatusBadge status={model.status} size="small" showIcon={false} />
          )}

          {model.status === "failed" && (!isNotModelOwner || userAccessLevel === "expert") && <ReportFailureButton model={model} />}

          {model.status === "completed" && getDemandFallback(model.results) && (
            <Tooltip>
              <TooltipTrigger asChild>
                <AlertTriangle className="h-4 w-4 text-amber-500" aria-label={t("model.demandFallbackTitle")} />
              </TooltipTrigger>
              <TooltipContent>
                {t("model.demandFallbackWarning", getDemandFallback(model.results) ?? undefined)}
              </TooltipContent>
            </Tooltip>
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

          {(model.status === "queue" ||
            model.status === "calculating" ||
            model.status === "running" ||
            model.status === "processing") && <SimulationProgress status={model.status} />}

          {(model.status === "completed" ||
            model.status === "failed" ||
            model.status === "cancelled") &&
            calculationCompletionInfo[model.id] && (
              <CompletedTimer
                totalSeconds={calculationCompletionInfo[model.id].totalSeconds}
                status={model.status}
              />
            )}
        </div>
      </td>

      <td className="hidden w-[14%] px-4 py-2.5 md:table-cell">
        <span className="text-xs tabular-nums text-muted-foreground">{formatDateTime(model.created_at)}</span>
      </td>

      <td className="px-4 py-2.5">
        <div className="flex items-center gap-1 transition-opacity duration-150 sm:opacity-80 sm:group-hover:opacity-100">
          <ModelActions
            model={model}
            currentUserId={currentUserId}
            userAccessLevel={userAccessLevel}
            onView={onView}
            onEdit={onEdit}
            onDownload={onDownload}
            onCopy={onCopy}
            onRunMeme={onRunMeme}
            onRunMemePypsa={onRunMemePypsa}
            onDelete={onDelete}
            onShare={onShare}
            onMoveToWorkspace={onMoveToWorkspace}
            disableDelete={!canManageModel}
            deleteTooltip={canManageModel ? t("common.delete") : t("model.sharedCannotDelete")}
            disableMoveToWorkspace={!canManageModel}
            moveToWorkspaceTooltip={
              canManageModel ? t("common.tooltips.moveToWorkspace") : t("model.sharedCannotMove")
            }
            disableShare={!canManageModel}
            shareTooltip={
              canManageModel ? t("common.tooltips.share") : t("model.sharedCannotShare")
            }
            layout="horizontal"
            size="large"
          />
        </div>
      </td>
    </tr>
  );
};

const completionInfoEqual = (prev?: CompletionInfo, next?: CompletionInfo): boolean => {
  if (!prev && !next) return true;
  if (!prev || !next) return false;
  return (
    prev.startTime === next.startTime &&
    prev.endTime === next.endTime &&
    prev.totalSeconds === next.totalSeconds
  );
};

const modelSnapshotEqual = (
  prev: Model & { level: number },
  next: Model & { level: number }
): boolean =>
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
  modelSharesSnapshot(prev) === modelSharesSnapshot(next) &&
  getErrorMessage(prev.results?.error) === getErrorMessage(next.results?.error) &&
  prev.results?.failed_service === next.results?.failed_service &&
  JSON.stringify(prev.results?.warning) === JSON.stringify(next.results?.warning);

const modelSharesSnapshot = (model: Model): string =>
  (model.shares ?? [])
    .map((share) => `${share.id}:${share.email}:${share.permission}`)
    .sort()
    .join("|");

const areRowPropsEqual = (prev: ModelTableRowProps, next: ModelTableRowProps): boolean => {
  if (!modelSnapshotEqual(prev.model, next.model)) return false;

  if (prev.modelTitle !== next.modelTitle) return false;
  if (prev.copyCount !== next.copyCount) return false;
  if (prev.failedCopyCount !== next.failedCopyCount) return false;
  if (prev.familyCollapsed !== next.familyCollapsed) return false;
  if (prev.onToggleFamily !== next.onToggleFamily) return false;
  if (prev.currentUserId !== next.currentUserId) return false;
  if (prev.userAccessLevel !== next.userAccessLevel) return false;
  if (prev.isSelected !== next.isSelected) return false;
  if (prev.isEditing !== next.isEditing) return false;
  if (prev.editTitle !== next.editTitle) return false;
  if (prev.canUserDeleteModel(prev.model) !== next.canUserDeleteModel(next.model)) return false;

  const modelID = prev.model.id;
  if ((prev.calculationStartTimes[modelID] ?? "") !== (next.calculationStartTimes[modelID] ?? ""))
    return false;
  if (
    !completionInfoEqual(
      prev.calculationCompletionInfo[modelID],
      next.calculationCompletionInfo[modelID]
    )
  )
    return false;

  return true;
};

export const ModelTableRow = memo(ModelTableRowBase, areRowPropsEqual);
