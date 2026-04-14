import React, { useState } from "react";
import type { FormDataConvertible } from "@/hooks/useForm";
import { createPortal } from "react-dom";
import {
	MessageSquare,
	Eye,
	Edit,
	MessageCircle,
	Bug,
	Lightbulb,
	Star,
	User,
	Calendar,
	AlertCircle,
	Clock,
	CheckCircle,
	XCircle,
	Trash2,
	RefreshCw,
	Filter,
	Tag,
	Flag,
	Image,
	ZoomIn,
	X,
} from "lucide-react";
import { IconX } from "@tabler/icons-react";
import Pagination from "@/components/ui/Pagination";
import ModelActionGroup from "@/components/shared/ModelActionGroup";
import { UniversalForm, FormSection } from "@spatialhub/forms";
import Notification from "@/components/ui/Notification";
import { Tooltip, TooltipTrigger, TooltipContent } from "@spatialhub/ui";
import { FilterDropdown } from "@/components/ui/FilterDropdown";
import { useConfirm } from "@/hooks/useConfirmDialog";
import { formatDateTime24h, formatDate } from "@/utils/dateHelpers";
import { useTranslation } from "@spatialhub/i18n";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
	useFeedbackList,
	useUpdateFeedback,
	useDeleteFeedback,
	FeedbackItem,
} from "@/features/admin-dashboard/hooks/useFeedbackQuery";

const COLOR_GRAY_NEUTRAL = "text-gray-500 dark:text-gray-400";
const COLOR_GRAY_DEFAULT = "text-gray-700";

interface FeedbackManagementProps {
	onFeedbackAction?: (action: string, feedbackId: number) => void;
}

// Feedback form configuration for editing
const getFeedbackFormSections = (t: (key: string) => string): FormSection[] => [
	{
		title: t("feedbackManagement.editDialog.statusAndPriority"),
		description: t("feedbackManagement.editDialog.statusAndPriorityDescription"),
		columns: 2,
		fields: [
			{
				key: "status",
				label: t("feedbackManagement.editDialog.status"),
				type: "select",
				value: "",
				required: true,
				icon: CheckCircle as any,
				options: [
					{ value: "pending", label: t("feedbackManagement.statuses.pending") },
					{ value: "in_progress", label: t("feedbackManagement.statuses.inProgress") },
					{ value: "resolved", label: t("feedbackManagement.statuses.resolved") },
					{ value: "closed", label: t("feedbackManagement.statuses.closed") },
				],
			},
			{
				key: "priority",
				label: t("feedbackManagement.editDialog.priority"),
				type: "select",
				value: "",
				required: true,
				icon: AlertCircle as any,
				options: [
					{ value: "low", label: t("feedbackManagement.priorities.low") },
					{ value: "medium", label: t("feedbackManagement.priorities.medium") },
					{ value: "high", label: t("feedbackManagement.priorities.high") },
					{ value: "critical", label: t("feedbackManagement.priorities.critical") },
				],
			},
		],
	},
	{
		title: t("feedbackManagement.editDialog.adminResponse"),
		description: t("feedbackManagement.editDialog.adminResponseDescription"),
		columns: 1,
		fields: [
			{
				key: "admin_response",
				label: t("feedbackManagement.editDialog.response"),
				type: "textarea",
				value: "",
				placeholder: t("feedbackManagement.editDialog.responsePlaceholder"),
				rows: 4,
				icon: MessageCircle as any,
			},
		],
	},
];

export const FeedbackManagement: React.FC<FeedbackManagementProps> = ({ onFeedbackAction }) => {
	const { t } = useTranslation();
	const [page, setPage] = useState(0);
	const [rowsPerPage, setRowsPerPage] = useState(10);
	const [isRefreshing, setIsRefreshing] = useState(false);

	// Dialog states
	const [viewDialogOpen, setViewDialogOpen] = useState(false);
	const [editDialogOpen, setEditDialogOpen] = useState(false);
	const [selectedFeedback, setSelectedFeedback] = useState<FeedbackItem | null>(null);
	const [imageLightboxOpen, setImageLightboxOpen] = useState(false);
	const [lightboxImageIndex, setLightboxImageIndex] = useState(0);
	const [imageLoadFailed, setImageLoadFailed] = useState<Record<number, boolean>>({});
	const confirm = useConfirm();

	// Filters
	const [statusFilter, setStatusFilter] = useState("all");
	const [categoryFilter, setCategoryFilter] = useState("all");
	const [priorityFilter, setPriorityFilter] = useState("all");

	// React Query hooks
	const { data: feedbackData, isLoading: loading, refetch } = useFeedbackList({
		page,
		per_page: rowsPerPage,
		status: statusFilter === "all" ? undefined : statusFilter,
		category: categoryFilter === "all" ? undefined : categoryFilter,
		priority: priorityFilter === "all" ? undefined : priorityFilter,
	});

	const updateFeedbackMutation = useUpdateFeedback();
	const deleteFeedbackMutation = useDeleteFeedback();

	const feedbacks = feedbackData?.data || [];
	const totalCount = feedbackData?.total || 0;

	// Edit form state
	const [editForm, setEditForm] = useState<{
		status: "pending" | "in_progress" | "resolved" | "closed";
		priority: "low" | "medium" | "high" | "critical";
		admin_response: string;
	}>({
		status: "pending",
		priority: "medium",
		admin_response: "",
	});

	// Form management for UniversalForm
	const [formLoading, setFormLoading] = useState(false);
	const [formErrors, setFormErrors] = useState<Record<string, string>>({});

	// Notification state
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

	// Handle form changes
	const handleFormChange = (field: string, value: FormDataConvertible) => {
		setEditForm((prev) => ({
			...prev,
			[field]: value,
		}));
		// Clear error when user starts typing
		if (formErrors[field]) {
			setFormErrors((prev) => ({
				...prev,
				[field]: "",
			}));
		}
	};

	// Reset form
	const resetForm = () => {
		setEditForm({
			status: "pending",
			priority: "medium",
			admin_response: "",
		});
		setFormErrors({});
	};

	const getCategoryIcon = (category: string) => {
		switch (category) {
			case "bug":
				return <Bug className="w-4 h-4" />;
			case "feature":
				return <Lightbulb className="w-4 h-4" />;
			case "improvement":
				return <Star className="w-4 h-4" />;
			default:
				return <MessageCircle className="w-4 h-4" />;
		}
	};

	const getCategoryColor = (category: string) => {
		switch (category) {
			case "bug":
				return "bg-gray-200 text-gray-800 border-gray-300";
			case "feature":
				return COLOR_GRAY_NEUTRAL;
			case "improvement":
				return "bg-gray-400 text-gray-900 border-gray-500";
			case "general":
				return "bg-gray-500 text-white border-gray-600";
			default:
				return COLOR_GRAY_DEFAULT;
		}
	};

	const getStatusColor = (status: string) => {
		switch (status) {
			case "pending":
				return "bg-amber-100 text-amber-800 border-amber-300 dark:bg-amber-900/30 dark:text-amber-300 dark:border-amber-700";
			case "in_progress":
				return "bg-blue-100 text-blue-800 border-blue-300 dark:bg-blue-900/30 dark:text-blue-300 dark:border-blue-700";
			case "resolved":
				return "bg-green-100 text-green-800 border-green-300 dark:bg-green-900/30 dark:text-green-300 dark:border-green-700";
			case "closed":
				return "bg-gray-100 text-gray-600 border-gray-300 dark:bg-gray-800/50 dark:text-gray-400 dark:border-gray-600";
			default:
				return COLOR_GRAY_DEFAULT;
		}
	};

	const getStatusIcon = (status: string) => {
		switch (status) {
			case "resolved":
				return <CheckCircle className="w-3 h-3" />;
			case "in_progress":
				return <Clock className="w-3 h-3" />;
			case "pending":
				return <AlertCircle className="w-3 h-3" />;
			case "closed":
				return <XCircle className="w-3 h-3" />;
			default:
				return <AlertCircle className="w-3 h-3" />;
		}
	};

	const getPriorityColor = (priority: string) => {
		switch (priority) {
			case "critical":
				return "bg-black text-white border-gray-800";
			case "high":
				return "bg-gray-700 text-white border-gray-800";
			case "medium":
				return "bg-gray-500 text-white border-gray-600";
			case "low":
				return COLOR_GRAY_NEUTRAL;
			default:
				return COLOR_GRAY_DEFAULT;
		}
	};

	const getCategoryLabel = (category: string) => {
		const key = `feedbackManagement.categories.${category}`;
		return t(key);
	};

	const getPriorityLabel = (priority: string) => {
		const key = `feedbackManagement.priorities.${priority}`;
		return t(key);
	};

	const getStatusLabel = (status: string) => {
		const statusKey = status === "in_progress" ? "inProgress" : status;
		const key = `feedbackManagement.statuses.${statusKey}`;
		return t(key);
	};

	const handleViewFeedback = (feedback: FeedbackItem) => {
		setSelectedFeedback(feedback);
		setImageLoadFailed({});
		setLightboxImageIndex(0);
		setViewDialogOpen(true);
	};

	const handleEditFeedback = (feedback: FeedbackItem) => {
		setSelectedFeedback(feedback);
		setEditForm({
			status: feedback.status,
			priority: feedback.priority,
			admin_response: feedback.admin_response || "",
		});
		setEditDialogOpen(true);
	};

	const handleSaveEdit = async () => {
		if (!selectedFeedback) return;

		setFormLoading(true);
		setFormErrors({});

		try {
			await updateFeedbackMutation.mutateAsync({
				id: selectedFeedback.id,
				updates: editForm,
			});
			setEditDialogOpen(false);
			setSelectedFeedback(null);
			resetForm();
			showNotification(t("feedbackManagement.notifications.updateSuccess", { subject: selectedFeedback.subject }), "success");
		} catch (error: unknown) {
			// Handle validation errors
			const respErrors = typeof error === 'object' && error && 'response' in error
				? (error as { response?: { data?: { errors?: Record<string, string> } } }).response?.data?.errors
				: undefined;
			if (respErrors) {
				setFormErrors(respErrors);
			}
			showNotification(t("feedbackManagement.notifications.updateError"), "error");
		} finally {
			setFormLoading(false);
		}
	};

	const handleDeleteFeedback = async (feedback: FeedbackItem) => {
		await confirm({
			type: "delete",
			itemType: "feedback",
			itemName: feedback.subject,
			isDangerous: false,
			onConfirm: async () => {
				try {
					await deleteFeedbackMutation.mutateAsync(feedback.id);
					setSelectedFeedback(null);
					showNotification(t("feedbackManagement.notifications.deleteSuccess", { subject: feedback.subject }), "success");
				} catch (error) {
					if (import.meta.env.DEV) console.error("Delete failed:", error);
					showNotification(t("feedbackManagement.notifications.deleteError"), "error");
				}
			},
			confirmLabel: t("feedbackManagement.actions.delete"),
		});
	};

	const handleFeedbackAction = (action: string, feedbackId: number) => {
		const feedback = feedbacks.find((f) => f.id === feedbackId);
		if (!feedback) return;

		switch (action) {
			case "view":
				handleViewFeedback(feedback);
				break;
			case "edit":
				handleEditFeedback(feedback);
				break;
			case "comment":
				handleEditFeedback(feedback);
				break;
			case "delete":
				handleDeleteFeedback(feedback);
				break;
		}

		if (onFeedbackAction) {
			onFeedbackAction(action, feedbackId);
		}
	};

	const renderStars = (rating: number) => {
		return (
			<div className="flex items-center gap-1">
				{[1, 2, 3, 4, 5].map((star) => (
					<Star key={star} className={`w-4 h-4 ${star <= rating ? "text-gray-700 fill-gray-700" : "text-gray-300"}`} />
				))}
			</div>
		);
	};

	const getStatusCounts = () => {
		const pending = feedbacks.filter((f) => f.status === "pending").length;
		const inProgress = feedbacks.filter((f) => f.status === "in_progress").length;
		const resolved = feedbacks.filter((f) => f.status === "resolved").length;
		return { pending, inProgress, resolved };
	};

	const statusCounts = getStatusCounts();

	const truncateWords = (text: string, maxWords: number) => {
		if (!text) return "";
		const words = text.trim().split(/\s+/);
		if (words.length <= maxWords) return text;
		return words.slice(0, maxWords).join(" ") + "…";
	};

	const formatFileSize = (bytes: number | null | undefined) => {
		if (!bytes) return "";
		if (bytes < 1024) return `${bytes} B`;
		if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	};

	const getImageUrl = (feedbackId: number, index?: number) => {
		if (index !== undefined) {
			return `/api/feedback/${feedbackId}/images/${index}`;
		}
		return `/api/feedback/${feedbackId}/image`;
	};

	const parseFeedbackImages = (feedback: FeedbackItem): { items: Array<{ path: string; mime_type: string; size: number }>; fromJson: boolean } => {
		if (feedback.images) {
			try {
				return { items: JSON.parse(feedback.images), fromJson: true };
			} catch { /* fallback below */ }
		}
		if (feedback.image_path) {
			return { items: [{ path: feedback.image_path, mime_type: feedback.image_mime_type || "", size: feedback.image_size || 0 }], fromJson: false };
		}
		return { items: [], fromJson: false };
	};

	if (loading && feedbacks.length === 0) {
		return (
			<div className="flex justify-center py-8">
				<div className="animate-spin rounded-full h-8 w-8 border-b-2 border-gray-600"></div>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{/* Header */}
			<div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
				<div className="flex items-center gap-3">
					<div className="p-2 bg-muted rounded-lg">
						<MessageSquare className="w-5 h-5 text-muted-foreground" />
					</div>
					<div>
						<h2 className="text-lg font-semibold text-foreground">{t("feedbackManagement.title")}</h2>
						<p className="text-xs text-muted-foreground">{t("feedbackManagement.subtitle")}</p>
					</div>
				</div>
				<div className="flex items-center gap-3">
					<Tooltip>
						<TooltipTrigger asChild>
							<button
								onClick={() => {
									setIsRefreshing(true);
									refetch();
									setTimeout(() => setIsRefreshing(false), 1000);
								}}
								disabled={loading}
								className="p-2.5 bg-muted text-muted-foreground rounded-lg hover:bg-muted/80 transition-colors duration-200 disabled:opacity-50"
							>
								<RefreshCw className={`w-4 h-4 transition-transform duration-500 ${loading || isRefreshing ? "animate-spin" : ""}`} />
							</button>
						</TooltipTrigger>
						<TooltipContent>{t("feedbackManagement.refresh")}</TooltipContent>
					</Tooltip>
					
					{/* Status badges */}
					<div className="flex items-center gap-2">
						<div className="flex items-center gap-1.5 px-3 py-1.5 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-800 rounded-lg">
							<div className="w-2 h-2 bg-yellow-500 rounded-full animate-pulse"></div>
							<span className="text-xs font-semibold text-yellow-800 dark:text-yellow-400">{statusCounts.pending}</span>
							<span className="text-xs text-yellow-600 dark:text-yellow-500">{t("feedbackManagement.statuses.pending")}</span>
						</div>
						<div className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-800 rounded-lg">
							<div className="w-2 h-2 bg-blue-500 rounded-full"></div>
							<span className="text-xs font-semibold text-blue-800 dark:text-blue-400">{statusCounts.inProgress}</span>
							<span className="text-xs text-blue-600 dark:text-blue-500">{t("feedbackManagement.statuses.inProgress")}</span>
						</div>
						<div className="flex items-center gap-1.5 px-3 py-1.5 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-800 rounded-lg">
							<div className="w-2 h-2 bg-green-500 rounded-full"></div>
							<span className="text-xs font-semibold text-green-800 dark:text-green-400">{statusCounts.resolved}</span>
							<span className="text-xs text-green-600 dark:text-green-500">{t("feedbackManagement.statuses.resolved")}</span>
						</div>
					</div>
				</div>
			</div>

			{/* Filters */}
			<div className="bg-card rounded-xl border border-border p-4">
				<div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
					<div className="flex items-center gap-2">
						<Filter className="w-4 h-4 text-muted-foreground" />
						<span className="text-sm font-medium text-foreground">{t("feedbackManagement.filters.label")}</span>
					</div>
					<div className="flex flex-wrap gap-3">
						<FilterDropdown
							options={[
								{ value: "all", label: t("feedbackManagement.filters.allStatus") },
								{ value: "pending", label: t("feedbackManagement.statuses.pending"), icon: <Clock className="w-3.5 h-3.5 text-yellow-500" /> },
								{ value: "in_progress", label: t("feedbackManagement.statuses.inProgress"), icon: <RefreshCw className="w-3.5 h-3.5 text-blue-500" /> },
								{ value: "resolved", label: t("feedbackManagement.statuses.resolved"), icon: <CheckCircle className="w-3.5 h-3.5 text-green-500" /> },
								{ value: "closed", label: t("feedbackManagement.statuses.closed"), icon: <XCircle className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300" /> },
							]}
							value={statusFilter}
							onChange={setStatusFilter}
							placeholder={t("feedbackManagement.filters.allStatus")}
							icon={<Clock className="w-3.5 h-3.5 text-muted-foreground" />}
						/>
						<FilterDropdown
							options={[
								{ value: "all", label: t("feedbackManagement.filters.allCategories") },
								{ value: "bug", label: t("feedbackManagement.categories.bug"), icon: <Bug className="w-3.5 h-3.5 text-red-500" /> },
								{ value: "feature", label: t("feedbackManagement.categories.feature"), icon: <Lightbulb className="w-3.5 h-3.5 text-yellow-500" /> },
								{ value: "improvement", label: t("feedbackManagement.categories.improvement"), icon: <Star className="w-3.5 h-3.5 text-blue-500" /> },
								{ value: "general", label: t("feedbackManagement.categories.general"), icon: <MessageCircle className="w-3.5 h-3.5 text-gray-500" /> },
							]}
							value={categoryFilter}
							onChange={setCategoryFilter}
							placeholder={t("feedbackManagement.filters.allCategories")}
							icon={<Tag className="w-3.5 h-3.5 text-muted-foreground" />}
						/>
						<FilterDropdown
							options={[
								{ value: "all", label: t("feedbackManagement.filters.allPriorities") },
								{ value: "critical", label: t("feedbackManagement.priorities.critical"), icon: <AlertCircle className="w-3.5 h-3.5 text-red-600" /> },
								{ value: "high", label: t("feedbackManagement.priorities.high"), icon: <Flag className="w-3.5 h-3.5 text-orange-500" /> },
								{ value: "medium", label: t("feedbackManagement.priorities.medium"), icon: <Flag className="w-3.5 h-3.5 text-yellow-500" /> },
								{ value: "low", label: t("feedbackManagement.priorities.low"), icon: <Flag className="w-3.5 h-3.5 text-green-500" /> },
							]}
							value={priorityFilter}
							onChange={setPriorityFilter}
							placeholder={t("feedbackManagement.filters.allPriorities")}
							icon={<Flag className="w-3.5 h-3.5 text-muted-foreground" />}
						/>
					</div>
				</div>
			</div>

			{/* Table */}
			<div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
				<div className="overflow-x-auto">
					<table className="min-w-full divide-y divide-border">
						<thead className="bg-muted/50">
							<tr>
								<th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("feedbackManagement.table.subject")}</th>
								<th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("feedbackManagement.table.category")}</th>
								<th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("feedbackManagement.table.priority")}</th>
								<th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("feedbackManagement.table.status")}</th>
								<th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("feedbackManagement.table.rating")}</th>
								<th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("feedbackManagement.table.user")}</th>
								<th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("feedbackManagement.table.created")}</th>
								<th className="px-6 py-4 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("feedbackManagement.table.actions")}</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-border">
							{feedbacks.length === 0 ? (
								<tr>
									<td colSpan={8} className="px-6 py-16 text-center">
										<div className="flex flex-col items-center justify-center gap-3">
											<div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-2xl flex items-center justify-center">
												<MessageSquare className="w-8 h-8 text-gray-400 dark:text-gray-300" />
											</div>
											<div>
												<p className="text-lg font-medium text-gray-900 dark:text-white mb-1">{t("feedbackManagement.noFeedbackFound")}</p>
												<p className="text-sm text-gray-500 dark:text-gray-400">{t("feedbackManagement.noFeedbackDescription")}</p>
											</div>
										</div>
									</td>
								</tr>
							) : (
								feedbacks.map((feedback) => {
									const displayUserName = feedback.user?.name || feedback.user_name || t("common.unknown");
									const displayUserEmail = feedback.user?.email || feedback.user_email || "";
									return (
										<tr key={feedback.id} className="hover:bg-muted/50 transition-colors duration-150">
											<td className="px-6 py-4 max-w-[200px]">
												<div className="min-w-0">
													<div className="flex items-center gap-1.5">
														<div className="text-sm font-medium text-foreground truncate" title={feedback.subject}>
															{truncateWords(feedback.subject, 4)}
														</div>
														{(feedback.images || feedback.image_path) && (() => {
														let count = 0;
														if (feedback.images) {
															try { count = JSON.parse(feedback.images).length; } catch { count = 1; }
														} else if (feedback.image_path) {
															count = 1;
														}
														return count > 0 ? (
															<Tooltip>
																<TooltipTrigger asChild>
																	<span className="flex-shrink-0 inline-flex items-center gap-0.5">
																		<Image className="w-3.5 h-3.5 text-blue-500" />
																		{count > 1 && <span className="text-[10px] font-medium text-blue-500">{count}</span>}
																	</span>
																</TooltipTrigger>
																<TooltipContent>{count === 1 ? t("feedbackManagement.hasAttachment") : `${count} attachments`}</TooltipContent>
															</Tooltip>
														) : null;
													})()}
													</div>
													<div className="text-xs text-muted-foreground truncate" title={feedback.message}>
														{truncateWords(feedback.message, 6)}
													</div>
												</div>
											</td>
											<td className="px-6 py-4">
												<span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${getCategoryColor(feedback.category)}`}>
													{getCategoryIcon(feedback.category)}
													{getCategoryLabel(feedback.category)}
												</span>
											</td>
											<td className="px-6 py-4">
												<span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium ${getPriorityColor(feedback.priority)}`}>
													{getPriorityLabel(feedback.priority)}
												</span>
											</td>
											<td className="px-6 py-4">
												<span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${getStatusColor(feedback.status)}`}>
													{getStatusIcon(feedback.status)}
													{getStatusLabel(feedback.status)}
												</span>
												{(feedback.status === "closed" || feedback.status === "resolved") && (() => {
													const updated = new Date(feedback.updated_at);
													const deleteAt = new Date(updated.getTime() + 7 * 24 * 60 * 60 * 1000);
													const daysLeft = Math.max(0, Math.ceil((deleteAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
													return (
														<div className="text-[10px] text-muted-foreground mt-0.5 italic">
															{daysLeft > 0 ? `Auto-deletes in ${daysLeft}d` : "Auto-deletes soon"}
														</div>
													);
												})()}
											</td>
											<td className="px-6 py-4">{renderStars(feedback.rating)}</td>
											<td className="px-6 py-4">
												<div className="flex items-center gap-2">
													<div className="w-8 h-8 bg-muted rounded-lg flex items-center justify-center text-white text-xs font-medium">
														{displayUserName.charAt(0).toUpperCase()}
													</div>
													<div className="min-w-0">
														<div className="text-sm font-medium text-foreground truncate">{displayUserName}</div>
														{displayUserEmail && (
															<div className="text-xs text-muted-foreground truncate">{displayUserEmail}</div>
														)}
													</div>
												</div>
											</td>
											<td className="px-6 py-4">
												<span className="text-sm text-foreground">{formatDate(feedback.created_at)}</span>
											</td>
											<td className="px-6 py-4 text-right">
												<ModelActionGroup
													actions={[
														{
															key: "view",
															icon: Eye,
															tooltip: t("feedbackManagement.actions.viewDetails"),
															variant: "info",
															onClick: () => handleFeedbackAction("view", feedback.id),
														},
														{
															key: "edit",
															icon: Edit,
															tooltip: t("feedbackManagement.actions.editStatus"),
															variant: "default",
															onClick: () => handleFeedbackAction("edit", feedback.id),
														},
														{
															key: "delete",
															icon: Trash2,
															tooltip: t("feedbackManagement.actions.deleteFeedback"),
															variant: "danger",
															onClick: () => handleFeedbackAction("delete", feedback.id),
														},
													]}
													layout="horizontal"
													size="small"
												/>
											</td>
										</tr>
									);
								})
							)}
						</tbody>
					</table>
				</div>

				{/* Pagination */}
				<Pagination
					currentPage={page}
					totalItems={totalCount}
					itemsPerPage={rowsPerPage}
					onPageChange={setPage}
					onItemsPerPageChange={(newSize) => {
						setRowsPerPage(newSize);
						setPage(0);
					}}
					isLoading={loading}
				/>
			</div>

			{/* View Feedback Modal */}
			{viewDialogOpen &&
				selectedFeedback &&
				createPortal(
					<div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 animate-in fade-in-0 duration-300">
						<button
							type="button"
							className="absolute inset-0 cursor-default bg-transparent border-0 p-0"
							onClick={() => {
								setViewDialogOpen(false);
								setImageLightboxOpen(false);
							}}
							aria-label={t("common.close")}
						/>
						<div className="flex items-center justify-center min-h-full p-4">
							<div className="relative w-full max-w-2xl h-[85vh] animate-in zoom-in-95 duration-300">
								<div className="bg-card dark:bg-card rounded-2xl shadow-2xl border border-border flex flex-col h-full overflow-hidden">
									{/* Header */}
									<div className="flex-shrink-0 p-4 pb-3 border-b border-border">
										<div className="flex justify-between items-start">
											<div className="flex items-center gap-3">
												<div className="w-10 h-10 bg-gradient-to-br from-gray-700 to-gray-900 dark:from-gray-600 dark:to-gray-800 rounded-xl flex items-center justify-center shadow-lg">
													<Eye className="w-5 h-5 text-white" />
												</div>
												<div>
													<h1 className="text-lg font-bold text-foreground">
														{t("feedbackManagement.viewDialog.title")}
													</h1>
													<p className="text-muted-foreground text-xs">
														#{selectedFeedback.id} • {formatDateTime24h(selectedFeedback.created_at)}
													</p>
												</div>
											</div>
											<button
												onClick={() => {
													setViewDialogOpen(false);
													setImageLightboxOpen(false);
												}}
												className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
											>
												<IconX className="w-4 h-4" />
											</button>
										</div>
									</div>

									{/* Content */}
									<div className="flex-1 overflow-y-auto min-h-0 scrollbar-thin scrollbar-thumb-gray-300 dark:scrollbar-thumb-gray-600 scrollbar-track-transparent">
										<div className="p-5 space-y-5">
											{/* Subject & Badges */}
											<div>
												<h4 className="text-base font-semibold text-foreground mb-2">{selectedFeedback.subject}</h4>
												<div className="flex flex-wrap items-center gap-2">
													<span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium border ${getStatusColor(selectedFeedback.status)}`}>
														{getStatusIcon(selectedFeedback.status)}
														{getStatusLabel(selectedFeedback.status)}
													</span>
													<span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-medium border ${getCategoryColor(selectedFeedback.category)}`}>
														{getCategoryIcon(selectedFeedback.category)}
														{getCategoryLabel(selectedFeedback.category)}
													</span>
													<span className={`inline-flex items-center px-2.5 py-1 rounded-lg text-xs font-medium ${getPriorityColor(selectedFeedback.priority)}`}>
														{getPriorityLabel(selectedFeedback.priority)}
													</span>
												</div>
											</div>

											{/* Message */}
											<div>
												<h5 className="text-sm font-medium text-foreground mb-2">{t("feedbackManagement.viewDialog.message")}</h5>
												<div className="text-sm p-4 bg-muted/20 rounded-lg border border-border prose prose-sm dark:prose-invert max-w-none
													prose-headings:text-foreground prose-headings:font-semibold prose-headings:mt-3 prose-headings:mb-1.5
													prose-p:text-foreground prose-p:leading-relaxed prose-p:my-1.5
													prose-strong:text-foreground
													prose-a:text-primary prose-a:no-underline hover:prose-a:underline
													prose-code:text-foreground prose-code:bg-muted prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-code:before:content-none prose-code:after:content-none
													prose-pre:bg-muted prose-pre:border prose-pre:border-border prose-pre:rounded-lg prose-pre:p-3
													prose-blockquote:border-l-2 prose-blockquote:border-border prose-blockquote:pl-4 prose-blockquote:italic prose-blockquote:text-muted-foreground
													prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0.5
													prose-hr:border-border
													prose-table:border-collapse prose-th:border prose-th:border-border prose-th:px-3 prose-th:py-1.5 prose-th:bg-muted/50 prose-th:text-left prose-th:text-xs prose-th:font-semibold
													prose-td:border prose-td:border-border prose-td:px-3 prose-td:py-1.5 prose-td:text-xs">
													<ReactMarkdown
														remarkPlugins={[remarkGfm]}
														components={{
															input: ({ type, checked, ...props }) =>
																type === "checkbox" ? (
																	<input type="checkbox" checked={checked} readOnly className="mr-1.5 rounded" {...props} />
																) : (
																	<input type={type} {...props} />
																),
															a: ({ children, ...props }) => (
																<a target="_blank" rel="noopener noreferrer" {...props}>{children}</a>
															),
														}}
													>
														{selectedFeedback.message}
													</ReactMarkdown>
												</div>
											</div>

											{/* Attached Images Gallery */}
											{(() => {
												const { items: images, fromJson } = parseFeedbackImages(selectedFeedback);
												if (images.length === 0) return null;
												return (
													<div>
														<h5 className="text-sm font-medium text-foreground mb-2 flex items-center gap-1.5">
															<Image className="w-4 h-4" />
															{t("feedbackManagement.viewDialog.attachedImage")}
															{images.length > 1 && <span className="text-xs text-muted-foreground">({images.length})</span>}
														</h5>
														<div className={`grid gap-3 ${images.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
															{images.map((img, idx) => (
																<div key={idx} className="relative group">
																	<div
																		className="relative rounded-lg overflow-hidden border border-border bg-muted/30 cursor-pointer aspect-video flex items-center justify-center"
																		onClick={() => { setLightboxImageIndex(idx); setImageLightboxOpen(true); }}
																	>
																		{imageLoadFailed[idx] ? (
																			<div className="flex flex-col items-center justify-center py-6 text-muted-foreground">
																				<svg className="w-6 h-6 mb-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
																					<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
																				</svg>
																				<span className="text-xs">{t("feedbackManagement.viewDialog.imageLoadError")}</span>
																			</div>
																		) : (
																			<img
																				src={fromJson ? getImageUrl(selectedFeedback.id, idx) : getImageUrl(selectedFeedback.id)}
																				alt={`${t("feedbackManagement.viewDialog.feedbackScreenshot")} ${idx + 1}`}
																				className="max-w-full max-h-full object-contain transition-transform duration-200 group-hover:scale-[1.02]"
																				onError={() => setImageLoadFailed(prev => ({ ...prev, [idx]: true }))}
																			/>
																		)}
																		<div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors duration-200 flex items-center justify-center opacity-0 group-hover:opacity-100">
																			<div className="bg-black/60 text-white px-2 py-1 rounded-lg flex items-center gap-1 text-xs">
																				<ZoomIn className="w-3 h-3" />
																				{t("feedbackManagement.viewDialog.clickToEnlarge")}
																			</div>
																		</div>
																	</div>
																	<p className="text-[10px] text-muted-foreground mt-1">
																		{formatFileSize(img.size)}
																		{img.mime_type && ` • ${img.mime_type.split('/')[1]?.toUpperCase()}`}
																	</p>
																</div>
															))}
														</div>
													</div>
												);
											})()}

											{/* Rating */}
											<div>
												<h5 className="text-sm font-medium text-foreground mb-2">{t("feedbackManagement.viewDialog.rating")}</h5>
												<div>{renderStars(selectedFeedback.rating)}</div>
											</div>

											{/* User & Date Info */}
											<div className="grid grid-cols-1 md:grid-cols-2 gap-4">
												<div className="bg-muted/30 p-3 rounded-lg border border-border/50">
													<h5 className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
														<User className="w-3.5 h-3.5" />
														{t("feedbackManagement.viewDialog.submittedBy") || "Submitted by"}
													</h5>
													<p className="text-sm font-medium text-foreground">
														{selectedFeedback.user?.name || selectedFeedback.user_name || t("common.unknown")}
													</p>
													{(selectedFeedback.user?.email || selectedFeedback.user_email) && (
														<p className="text-xs text-muted-foreground mt-0.5">
															{selectedFeedback.user?.email || selectedFeedback.user_email}
														</p>
													)}
												</div>
												<div className="bg-muted/30 p-3 rounded-lg border border-border/50">
													<h5 className="text-xs font-medium text-muted-foreground mb-1 flex items-center gap-1">
														<Calendar className="w-3.5 h-3.5" />
														{t("feedbackManagement.viewDialog.submitted")}
													</h5>
													<p className="text-sm font-medium text-foreground">
														{formatDateTime24h(selectedFeedback.created_at)}
													</p>
													{selectedFeedback.updated_at !== selectedFeedback.created_at && (
														<p className="text-xs text-muted-foreground mt-0.5">
															Updated: {formatDateTime24h(selectedFeedback.updated_at)}
														</p>
													)}
												</div>
											</div>

											{/* Admin Response */}
											{selectedFeedback.admin_response && (
												<div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
													<h5 className="text-sm font-medium text-blue-800 dark:text-blue-300 mb-2 flex items-center gap-1.5">
														<MessageCircle className="w-4 h-4" />
														{t("feedbackManagement.viewDialog.adminResponse")}
													</h5>
													<p className="text-sm text-blue-900 dark:text-blue-200 whitespace-pre-wrap">
														{selectedFeedback.admin_response}
													</p>
													{selectedFeedback.responded_at && (
														<p className="text-xs text-blue-600 dark:text-blue-400 mt-2">
															{t("feedbackManagement.viewDialog.respondedOn")} {formatDateTime24h(selectedFeedback.responded_at)}
															{selectedFeedback.responded_by_user?.name && ` • ${selectedFeedback.responded_by_user.name}`}
														</p>
													)}
												</div>
											)}

											{/* Auto-delete notice */}
											{(selectedFeedback.status === "closed" || selectedFeedback.status === "resolved") && (() => {
												const updated = new Date(selectedFeedback.updated_at);
												const deleteAt = new Date(updated.getTime() + 7 * 24 * 60 * 60 * 1000);
												const daysLeft = Math.max(0, Math.ceil((deleteAt.getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
												return (
													<div className="bg-amber-50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800 rounded-lg px-4 py-2.5 flex items-center gap-2">
														<Clock className="w-4 h-4 text-amber-600 dark:text-amber-400 flex-shrink-0" />
														<p className="text-xs text-amber-700 dark:text-amber-300">
															{daysLeft > 0
																? `This feedback will be automatically removed in ${daysLeft} day${daysLeft !== 1 ? "s" : ""}`
																: "This feedback will be automatically removed soon"}
														</p>
													</div>
												);
											})()}
										</div>
									</div>
								</div>
							</div>
						</div>
					</div>,
					document.body
				)}

			{/* Image Lightbox Modal */}
			{imageLightboxOpen &&
				selectedFeedback &&
				createPortal(
					<div className="fixed inset-0 bg-black/90 z-[60] animate-in fade-in-0 duration-200">
						<button
							type="button"
							className="absolute inset-0 cursor-default bg-transparent border-0 p-0"
							onClick={() => setImageLightboxOpen(false)}
							aria-label={t("common.close")}
						/>
						<div className="flex items-center justify-center h-full p-4">
							<div className="relative max-w-[90vw] max-h-[90vh]">
								<button
									onClick={() => setImageLightboxOpen(false)}
									className="absolute -top-10 right-0 p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors z-10"
									aria-label={t("common.close")}
								>
									<X className="w-6 h-6" />
								</button>
								{(() => {
									const { items: images, fromJson } = parseFeedbackImages(selectedFeedback);
									const hasMultiple = images.length > 1;
									return (
										<>
											<img
												src={fromJson ? getImageUrl(selectedFeedback.id, lightboxImageIndex) : getImageUrl(selectedFeedback.id)}
												alt={`${t("feedbackManagement.viewDialog.feedbackScreenshot")} ${lightboxImageIndex + 1}`}
												className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
											/>
											{hasMultiple && (
												<div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-2 bg-black/70 rounded-full px-3 py-1.5">
													<button
														onClick={(e) => { e.stopPropagation(); setLightboxImageIndex(prev => Math.max(0, prev - 1)); }}
														disabled={lightboxImageIndex === 0}
														className="text-white/80 hover:text-white disabled:text-white/30 transition-colors text-sm px-1"
													>
														‹
													</button>
													<span className="text-white/80 text-xs">{lightboxImageIndex + 1} / {images.length}</span>
													<button
														onClick={(e) => { e.stopPropagation(); setLightboxImageIndex(prev => Math.min(images.length - 1, prev + 1)); }}
														disabled={lightboxImageIndex >= images.length - 1}
														className="text-white/80 hover:text-white disabled:text-white/30 transition-colors text-sm px-1"
													>
														›
													</button>
												</div>
											)}
											{images[lightboxImageIndex] && (
												<p className="absolute -bottom-8 left-1/2 transform -translate-x-1/2 text-sm text-white/70">
													{formatFileSize(images[lightboxImageIndex].size)}
													{images[lightboxImageIndex].mime_type && ` • ${images[lightboxImageIndex].mime_type.split('/')[1]?.toUpperCase()}`}
												</p>
											)}
										</>
									);
								})()}
							</div>
						</div>
					</div>,
					document.body
				)}

			{/* Edit Feedback Modal */}
			<UniversalForm
				isOpen={editDialogOpen}
				onClose={() => {
					setEditDialogOpen(false);
					setSelectedFeedback(null);
					resetForm();
				}}
				title={t("feedbackManagement.editDialog.title")}
				description={t("feedbackManagement.editDialog.description")}
				variant="default"
				sections={getFeedbackFormSections(t)}
				values={editForm}
				onChange={handleFormChange}
				onSubmit={handleSaveEdit}
				submitText={t("feedbackManagement.editDialog.saveChanges")}
				loading={formLoading}
				errors={formErrors}
				maxWidth="lg"
			/>

			{/* Notification */}
			<Notification
				isOpen={notification.isOpen}
				message={notification.message}
				severity={notification.severity}
				onClose={() => setNotification({ ...notification, isOpen: false })}
			/>
		</div>
	);
};

