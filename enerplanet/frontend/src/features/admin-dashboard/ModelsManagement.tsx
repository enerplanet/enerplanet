import React, { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { Brain, RefreshCw, Users, Search, TrendingUp, Clock, CheckCircle2, AlertCircle, XCircle, Pause, ArrowUpDown, ArrowUp, ArrowDown } from "lucide-react";
import ModelStatusCards from "@/components/ui/cards/ModelStatusCards";
import StatusBadge from "@/components/ui/StatusBadge";
import ModelActions from "@/components/ui/ModelActions";
import Pagination from "@/components/ui/Pagination";
import Notification from "@/components/ui/Notification";
import { ShareModelModal } from "@/features/model-dashboard/components/ShareModelModal";
import { Tooltip, TooltipTrigger, TooltipContent } from "@spatialhub/ui";
import {
	useModelsQuery,
	useModelStatsQuery,
	useDuplicateModelMutation,
	useStartCalculationMutation,
	useDeleteModelMutation
} from "@/features/model-dashboard/hooks/useModelsQuery";
import { formatDate } from "@/utils/dateHelpers";
import { getModelStatusColor } from "@/features/model-dashboard/utils/statusHelpers";
import type { Model } from "@/features/model-dashboard/services/modelService";
import { useWebservices } from "@/features/admin-dashboard/hooks/useWebservices";
import { useAuthStore } from "@/store/auth-store";
import { useTranslation } from "@spatialhub/i18n";
import { useConfirm } from "@/hooks/useConfirmDialog";

interface ModelsManagementProps {
	onModelAction?: (action: string, modelId: number) => void;
}

export const ModelsManagement: React.FC<ModelsManagementProps> = ({ onModelAction }) => {
	const { t } = useTranslation();
	const navigate = useNavigate();
	const user = useAuthStore((state) => state.user);
	const confirm = useConfirm();

	const [currentPage, setCurrentPage] = useState(0);
	const [itemsPerPage, setItemsPerPage] = useState(5);
	const [searchTerm, setSearchTerm] = useState("");
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [sortBy, setSortBy] = useState<string>("created_at");
	const [sortOrder, setSortOrder] = useState<"asc" | "desc">("desc");

	const { data: modelsResponse, isLoading, refetch } = useModelsQuery({
		limit: itemsPerPage,
		offset: currentPage * itemsPerPage,
		search: searchTerm || undefined,
		sort_by: sortBy,
		sort_order: sortOrder,
	}, { requireWorkspace: false });

	const { data: statsResponse } = useModelStatsQuery();

	const models = modelsResponse?.data || [];
	const totalItems = modelsResponse?.total || 0;

	// Webservice availability check - refresh every 15 seconds for responsive button updates
	const { summary: webserviceSummary } = useWebservices({}, { autoRefresh: true, refreshInterval: 15000 });
	const hasAvailableWebservice = (webserviceSummary?.available ?? 0) > 0;

	const duplicateMutation = useDuplicateModelMutation();
	const startCalculationMutation = useStartCalculationMutation();
	const deleteMutation = useDeleteModelMutation();

	const [shareOpen, setShareOpen] = useState(false);
	const [selectedModel, setSelectedModel] = useState<Model | null>(null);

	const [notification, setNotification] = useState({
		isOpen: false,
		message: "",
		severity: "success" as "success" | "error" | "warning" | "info"
	});

	const showNotification = (message: string, severity: "success" | "error" | "warning" | "info" = "success") => {
		setNotification({
			isOpen: true,
			message,
			severity
		});
	};

	const handleShare = (model: Model) => {
		setSelectedModel(model);
		setShareOpen(true);
	};

	const handleView = (model: Model) => {
		navigate(`/app/model-results/${model.id}`, { state: { from: 'admin' } });
		onModelAction?.("view", model.id);
	};

	const handleEdit = (model: Model) => {
		navigate(`/app/model-dashboard/edit/${model.id}`);
		onModelAction?.("edit", model.id);
	};

	const handleCopy = async (model: Model) => {
		try {
			await duplicateMutation.mutateAsync(model.id);
			onModelAction?.("copy", model.id);
			showNotification(t("modelsManagement.notifications.duplicated", { title: model.title }), "success");
		} catch (error) {
			if (import.meta.env.DEV) console.error("Failed to copy model:", error);
			showNotification(t("modelsManagement.notifications.failedToDuplicate"), "error");
		}
	};

	const handleCalculate = async (modelIds: number[]) => {
		try {
			for (const id of modelIds) {
				await startCalculationMutation.mutateAsync(id);
				onModelAction?.("start_calculation", id);
			}
			showNotification(t("modelsManagement.notifications.calculationStarted"), "success");
		} catch (error) {
			if (import.meta.env.DEV) console.error("Failed to start calculation:", error);
			showNotification(t("modelsManagement.notifications.failedToCalculate"), "error");
		}
	};

	const handleDownload = (model: Model) => {
		onModelAction?.("download", model.id);
	};

	const handleMoveToWorkspace = (model: Model) => {
		showNotification(t("modelsManagement.notifications.moveComingSoon", { title: model.title }), "info");
	};

	const handleDelete = useCallback(async (model: Model) => {
		await confirm({
			type: "delete",
			itemType: "model",
			itemName: model.title,
			onConfirm: async () => {
				try {
					await deleteMutation.mutateAsync(model.id);
					onModelAction?.("delete", model.id);
					showNotification(t("modelsManagement.notifications.deleted", { title: model.title }), "success");
				} catch (error) {
					if (import.meta.env.DEV) console.error("Failed to delete model:", error);
					showNotification(t("modelsManagement.notifications.failedToDelete"), "error");
				}
			}
		});
	}, [confirm, deleteMutation, onModelAction, showNotification, t]);

	const handlePageChange = (page: number) => {
		setCurrentPage(page);
	};

	const handleItemsPerPageChange = (newItemsPerPage: number) => {
		setItemsPerPage(newItemsPerPage);
		setCurrentPage(0);
	};

	const handleSort = (column: string) => {
		if (sortBy === column) {
			setSortOrder(prev => prev === "asc" ? "desc" : "asc");
		} else {
			setSortBy(column);
			setSortOrder(column === "title" ? "asc" : "desc");
		}
		setCurrentPage(0);
	};

	const renderSortIcon = (column: string) => {
		if (sortBy !== column) return <ArrowUpDown className="w-3 h-3 text-muted-foreground/50" />;
		return sortOrder === "asc"
			? <ArrowUp className="w-3 h-3 text-foreground" />
			: <ArrowDown className="w-3 h-3 text-foreground" />;
	};

	const statusCounts = statsResponse?.data
		? {
			draft: statsResponse.data.draft,
			inQueue: statsResponse.data.queue,
			calculating: statsResponse.data.running,
			finished: statsResponse.data.completed,
			published: statsResponse.data.published,
		}
		: { draft: 0, inQueue: 0, calculating: 0, finished: 0, published: 0 };

	const getStatusIcon = (status: string) => {
		switch (status) {
			case "completed":
				return <CheckCircle2 className="w-4 h-4 text-green-500" />;
			case "running":
				return <TrendingUp className="w-4 h-4 text-blue-500 animate-pulse" />;
			case "queued":
				return <Clock className="w-4 h-4 text-yellow-500" />;
			case "failed":
				return <XCircle className="w-4 h-4 text-red-500" />;
			case "cancelled":
				return <Pause className="w-4 h-4 text-gray-500 dark:text-gray-400" />;
			default:
				return <AlertCircle className="w-4 h-4 text-gray-400 dark:text-gray-300" />;
		}
	};

	const renderTableContent = () => {
		if (isLoading) {
			return (
				<>
					<tr>
						<td colSpan={5} className="px-4 pt-4">
							<div className="flex items-center gap-2 text-sm text-muted-foreground">
								<RefreshCw className="h-4 w-4 animate-spin" />
								<span>{t("modelsManagement.loadingModels")}</span>
							</div>
						</td>
					</tr>
					{Array.from({ length: 5 }, (_, i) => (
						<tr key={i}>
							<td colSpan={5} className="px-4 py-3.5">
								<div className="flex items-center gap-4">
									<div className="md-skeleton h-4 w-4 shrink-0 rounded bg-muted" />
									<div
										className="md-skeleton h-3.5 w-full max-w-[220px] rounded-md bg-muted"
										style={{ animationDelay: `${i * 90}ms` }}
									/>
									<div className="md-skeleton hidden h-5 w-20 shrink-0 rounded-full bg-muted sm:block" />
									<div className="md-skeleton hidden h-3.5 w-24 shrink-0 rounded-md bg-muted md:block" />
									<div className="md-skeleton ml-auto h-6 w-24 shrink-0 rounded-md bg-muted" />
								</div>
							</td>
						</tr>
					))}
				</>
			);
		}

		if (models.length === 0) {
			return (
				<tr>
					<td colSpan={5} className="px-4 py-6">
						<div className="md-fade-in flex flex-col items-center rounded-xl border border-dashed border-border bg-muted/30 px-6 py-14 text-center">
							<div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border bg-card shadow-sm">
								<Brain className="w-8 h-8 text-gray-400 dark:text-gray-300" />
							</div>
							<div>
								<p className="text-lg font-medium text-gray-900 dark:text-white mb-1">{t("modelsManagement.noModelsFound")}</p>
								<p className="text-sm text-gray-500 dark:text-gray-400">{t("modelsManagement.noModelsDescription")}</p>
							</div>
						</div>
					</td>
				</tr>
			);
		}

		return models.map((model) => {
			const isInSharedWorkspace = user?.id && model.workspace && 
				String(model.workspace.user_id) !== String(user.id);
			
			return (
				<tr key={model.id} className="transition-colors duration-150 hover:bg-muted/40">
					<td className="px-3 py-2">
						<div className="flex items-center gap-2.5">
							<div className="w-8 h-8 bg-muted rounded-lg flex items-center justify-center flex-shrink-0">
								{getStatusIcon(model.status)}
							</div>
							<div className="min-w-0">
								<div className="flex items-center gap-2">
									<span className="text-sm font-medium text-foreground truncate">{model.title}</span>
									{isInSharedWorkspace && (
										<Tooltip>
											<TooltipTrigger asChild>
												<span className="inline-flex items-center px-1.5 py-0.5 rounded bg-muted">
													<Users className="w-2.5 h-2.5 text-muted-foreground" />
												</span>
											</TooltipTrigger>
											<TooltipContent>{t("modelsManagement.sharedWorkspace", { owner: model.workspace?.user_email || 'Unknown' })}</TooltipContent>
										</Tooltip>
									)}
								</div>
								<div className="text-[10px] text-muted-foreground">ID: {model.id}</div>
							</div>
						</div>
					</td>
					<td className="px-3 py-2">
						<StatusBadge
							status={model.status}
							variant="filled"
							size="small"
							className={getModelStatusColor(model.status)}
						/>
					</td>
					<td className="px-3 py-2">
						<span className="text-xs text-foreground">{formatDate(model.created_at)}</span>
					</td>
					<td className="px-3 py-2">
						<span className="text-xs text-foreground">{formatDate(model.updated_at)}</span>
					</td>
					<td className="px-3 py-2">
						<div className="flex items-center gap-1 justify-end">
							<ModelActions
								model={model}
								currentUserId={user?.id ? String(user.id) : undefined}
								userAccessLevel="expert"
								onView={(m) => handleView(m as unknown as Model)}
								onEdit={(m) => handleEdit(m as unknown as Model)}
								onDownload={(m) => handleDownload(m as unknown as Model)}
								onCopy={(m) => handleCopy(m as unknown as Model)}
								onDelete={(m) => handleDelete(m as unknown as Model)}
								onCalculate={(m) => handleCalculate([m.id])}
								onShare={(m) => handleShare(m as unknown as Model)}
								onMoveToWorkspace={(m) => handleMoveToWorkspace(m as unknown as Model)}
								hasAvailableWebservice={hasAvailableWebservice}
								layout="horizontal"
								size="small"
							/>
						</div>
					</td>
				</tr>
			);
		});
	};

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="md-rise flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
				<div className="flex items-center gap-3">
					<div className="flex h-10 w-10 items-center justify-center rounded-xl border border-border bg-card shadow-sm">
						<Brain className="w-5 h-5 text-muted-foreground" />
					</div>
					<div>
						<h2 className="text-lg font-semibold text-foreground">{t("modelsManagement.title")}</h2>
						<p className="text-xs text-muted-foreground">{t("modelsManagement.subtitle")}</p>
					</div>
				</div>
				<div className="flex items-center gap-2">
					<div className="relative">
						<Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
						<input
							type="text"
							placeholder={t("modelsManagement.searchPlaceholder")}
							value={searchTerm}
							onChange={(e) => setSearchTerm(e.target.value)}
							className="h-9 w-48 md:w-64 rounded-lg border border-input bg-background pl-9 pr-3 text-sm text-foreground shadow-sm transition-colors duration-150 placeholder:text-muted-foreground hover:border-muted-foreground/40 focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent"
						/>
					</div>
					<Tooltip>
						<TooltipTrigger asChild>
							<button
								onClick={() => {
									setIsRefreshing(true);
									refetch();
									setTimeout(() => setIsRefreshing(false), 1000);
								}}
								disabled={isLoading}
								className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-border bg-card text-muted-foreground shadow-sm transition-colors duration-150 hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
							>
								<RefreshCw className={`w-4 h-4 transition-transform duration-500 ${isLoading || isRefreshing ? "animate-spin" : ""}`} />
							</button>
						</TooltipTrigger>
						<TooltipContent>{t("modelsManagement.refresh")}</TooltipContent>
					</Tooltip>
				</div>
			</div>

			{/* Status Cards */}
			<div className="md-rise" style={{ animationDelay: "60ms" }}>
				<ModelStatusCards statusCounts={statusCounts} />
			</div>

			{/* Table */}
			<div className="md-rise bg-card rounded-xl border border-border overflow-hidden shadow-sm" style={{ animationDelay: "120ms" }}>
				{isLoading && (
					<div className="h-1 bg-muted overflow-hidden">
						<div className="h-full w-1/3 bg-gradient-to-r from-gray-400 to-gray-600 animate-[shimmer_1.5s_infinite]"></div>
					</div>
				)}
				<div className="md-fade-in overflow-x-auto">
					<table className="min-w-full divide-y divide-border">
						<thead>
							<tr className="border-b border-border bg-muted/40">
								<th
									className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground select-none"
									onClick={() => handleSort("title")}
								>
									<span className="inline-flex items-center gap-1">
										{t("modelsManagement.table.model")}
										{renderSortIcon("title")}
									</span>
								</th>
								<th
									className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground select-none"
									onClick={() => handleSort("status")}
								>
									<span className="inline-flex items-center gap-1">
										{t("modelsManagement.table.status")}
										{renderSortIcon("status")}
									</span>
								</th>
								<th
									className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground select-none"
									onClick={() => handleSort("created_at")}
								>
									<span className="inline-flex items-center gap-1">
										{t("modelsManagement.table.created")}
										{renderSortIcon("created_at")}
									</span>
								</th>
								<th
									className="px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-wider text-muted-foreground cursor-pointer hover:text-foreground select-none"
									onClick={() => handleSort("updated_at")}
								>
									<span className="inline-flex items-center gap-1">
										{t("modelsManagement.table.lastModified")}
										{renderSortIcon("updated_at")}
									</span>
								</th>
								<th className="px-3 py-2 text-right text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("modelsManagement.table.actions")}</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-border">
							{renderTableContent()}
						</tbody>
					</table>
				</div>

				<Pagination
					currentPage={currentPage}
					totalItems={totalItems}
					itemsPerPage={itemsPerPage}
					onPageChange={handlePageChange}
					onItemsPerPageChange={handleItemsPerPageChange}
					isLoading={isLoading}
				/>
			</div>

			<ShareModelModal
				isOpen={shareOpen}
				model={selectedModel}
				onClose={() => setShareOpen(false)}
				onSuccess={() => {
					setShareOpen(false);
					showNotification(t("modelsManagement.notifications.shared"), 'success');
				}}
			/>

			<Notification
				isOpen={notification.isOpen}
				message={notification.message}
				severity={notification.severity}
				onClose={() => setNotification({ ...notification, isOpen: false })}
			/>
		</div>
	);
};
