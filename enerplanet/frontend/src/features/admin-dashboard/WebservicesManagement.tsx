import React, { useState, useEffect, useRef } from "react";
import Notification from "@/components/ui/Notification";
import { useConfirm } from "@/hooks/useConfirmDialog";
import { UniversalForm } from "@spatialhub/forms";
import { getWebserviceFormSections, validateWebserviceForm } from "@/configuration/formConfigurations";
import ModelActionGroup from "@/components/shared/ModelActionGroup";
import { Tooltip, TooltipTrigger, TooltipContent } from "@spatialhub/ui";
import { FilterDropdown } from "@/components/ui/FilterDropdown";
import Pagination from "@/components/ui/Pagination";
import { WebserviceFilters, WebserviceFormData, WebserviceInstance } from "@/features/admin-dashboard/types";
import type { FormDataConvertible } from "@/hooks/useForm";
import { useWebservices } from "@/features/admin-dashboard/hooks/useWebservices";
import { useAuthStore } from "@/store/auth-store";
import { formatDateTime24h } from "@/utils/dateHelpers";
import { useTranslation } from "@spatialhub/i18n";
import { modelService } from "@/features/model-dashboard/services/modelService";
import {
	Plus,
	RefreshCw,
	Edit,
	Trash2,
	CheckCircle,
	HardDrive,
	Search,
	Settings,
	XCircle,
	Zap,
	RotateCw,
	Clock,
	Cloud,
	Cpu,
	Activity,
	Server,
	Wifi,
	WifiOff,
} from "lucide-react";

interface WebservicesManagementProps {
	onWebserviceAction?: (action: string, serviceId: number) => void;
	readOnly?: boolean;
}

interface NotificationState {
	open: boolean;
	message: string;
	severity: "success" | "error" | "warning";
}

const WebservicesManagement: React.FC<WebservicesManagementProps> = ({ onWebserviceAction, readOnly = false }) => {
	const { t } = useTranslation();
	const { user } = useAuthStore();

	const {
		webservices,
		loading,
		error,
		summary,
		loadWebservices,
		createWebservice,
		updateWebservice,
		deleteWebservice,
		markAvailable,
		markUnavailable,
		markBusy,
		markIdle,
		pingWebservice,
	} = useWebservices(
		{},
		{
			autoRefresh: true,
			refreshInterval: 30000, // 30 seconds
		}
	);

	// Fetch user's model stats to show queue position
	const [userQueueCount, setUserQueueCount] = useState<number>(0);
	const [userRunningCount, setUserRunningCount] = useState<number>(0);

	useEffect(() => {
		const fetchUserStats = async () => {
			try {
				const response = await modelService.getModelStats();
				if (response.success && response.data) {
					setUserQueueCount(response.data.queue || 0);
					setUserRunningCount(response.data.running || 0);
				}
			} catch {
				// Ignore errors
			}
		};
		fetchUserStats();
		const interval = setInterval(fetchUserStats, 30000); // Refresh every 30 seconds
		return () => clearInterval(interval);
	}, []);

	const [addDialogOpen, setAddDialogOpen] = useState(false);
	const [editDialogOpen, setEditDialogOpen] = useState(false);
	const [selectedService, setSelectedService] = useState<WebserviceInstance | null>(null);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const confirm = useConfirm();

	const [notification, setNotification] = useState<NotificationState>({
		open: false,
		message: "",
		severity: "success",
	});

	const [formData, setFormData] = useState<WebserviceFormData>({
		name: "",
		ip: "",
		port: 8085,
		protocol: "http",
		endpoint: "",
		auto_scaling: false,
		max_concurrency: 1,
		status: "inactive",
	});
	const [formErrors, setFormErrors] = useState<Record<string, string>>({});
	const [formLoading, setFormLoading] = useState(false);

	const [filters, setFilters] = useState<WebserviceFilters>({
		status: "",
		available: "",
		search: "",
	});

	const [searchInput, setSearchInput] = useState("");
	const [currentPage, setCurrentPage] = useState(0);
	const [itemsPerPage, setItemsPerPage] = useState(5);
	const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

	useEffect(() => {
		if (debounceTimerRef.current) {
			clearTimeout(debounceTimerRef.current);
		}

		debounceTimerRef.current = setTimeout(() => {
			setFilters(prev => ({ ...prev, search: searchInput }));
		}, 500);

		return () => {
			if (debounceTimerRef.current) {
				clearTimeout(debounceTimerRef.current);
			}
		};
	}, [searchInput]);

	useEffect(() => {
		loadWebservices({ status: "", available: "", search: "" });
	}, [loadWebservices]);

	useEffect(() => {
		loadWebservices({
			status: filters.status,
			available: filters.available,
			search: filters.search,
		});
		setCurrentPage(0); // Reset page when filters change
	}, [filters.status, filters.available, filters.search, loadWebservices]);

	useEffect(() => {
		if (error) {
			setNotification({
				open: true,
				message: error,
				severity: "error",
			});
		}
	}, [error]);

	if (!user) {
		return (
			<div className="flex justify-center items-center min-h-64">
				<div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-600" />
			</div>
		);
	}

	const handleServiceAction = async (serviceId: number, action: string, serviceName?: string) => {
		try {
			switch (action) {
				case "mark_available":
					await markAvailable(serviceId);
					break;
				case "mark_unavailable":
					await markUnavailable(serviceId);
					break;
				case "mark_busy":
					await markBusy(serviceId);
					break;
				case "mark_idle":
					await markIdle(serviceId);
					break;
				case "health_check":
				case "ping": {
					const pingResult = await pingWebservice(serviceId);
					const isAvailable = pingResult?.available;
					const status = isAvailable ? t("webservicesManagement.status.available") : t("webservicesManagement.status.unavailable");
					const serviceLabel = serviceName || `${t("webservicesManagement.table.service")} ${serviceId}`;

					setNotification({
						open: true,
						message: `${t("webservicesManagement.healthCheck")}: ${serviceLabel} - ${status}`,
						severity: isAvailable ? "success" : "warning",
					});

					if (onWebserviceAction) {
						onWebserviceAction(action, serviceId);
					}
					return;
				}
				default:
					return;
			}

			const actionMessage = t("webservicesManagement.notifications.statusChanged", { status: action.replace("_", " ") });

			setNotification({
				open: true,
				message: actionMessage,
				severity: "success",
			});

			if (onWebserviceAction) {
				onWebserviceAction(action, serviceId);
			}
		} catch (error: unknown) {
			const fallbackMessage = action === "ping" || action === "health_check"
				? t("webservicesManagement.notifications.failedToPing")
				: t("webservicesManagement.notifications.failedToUpdate");
			const message = typeof error === 'object' && error && 'message' in error ? String((error as { message?: string }).message) : fallbackMessage;
			setNotification({ open: true, message, severity: "error" });
		}
	};

	const resetForm = () => {
		setFormData({
			name: "",
			ip: "",
			port: 8085,
			protocol: "http",
			endpoint: "",
			auto_scaling: false,
			max_concurrency: 1,
			status: "inactive",
		});
		setFormErrors({});
		setSelectedService(null);
	};

	const handleFormChange = (key: string, value: FormDataConvertible) => {
		setFormData((prev) => ({
			...prev,
			[key]: value,
		}));

		if (formErrors[key]) {
			setFormErrors((prev) => {
				const newErrors = { ...prev };
				delete newErrors[key];
				return newErrors;
			});
		}
	};

	const handleSaveWebservice = async () => {
		setFormLoading(true);
		setFormErrors({});

		try {
			const errors = validateWebserviceForm(formData as unknown as Record<string, unknown>, t);

			if (Object.keys(errors).length > 0) {
				setFormErrors(errors);
				return;
			}

			const apiData = {
				name: formData.name || undefined,
				ip: formData.ip,
				port: formData.port,
				protocol: formData.protocol,
				endpoint: formData.endpoint || undefined,
				auto_scaling: formData.auto_scaling,
				max_concurrency: formData.max_concurrency,
				status: formData.status,
			};

			let result;

			if (selectedService) {
				result = await updateWebservice(selectedService.id, apiData);
			} else {
				result = await createWebservice(apiData);
			}

			if (result) {
				setAddDialogOpen(false);
				setEditDialogOpen(false);
				resetForm();
				setNotification({
					open: true,
					message: selectedService ? t("webservicesManagement.notifications.updated") : t("webservicesManagement.notifications.created"),
					severity: "success",
				});
			}
		} catch (error: unknown) {
			const fallback = selectedService ? t("webservicesManagement.notifications.failedToUpdate") : t("webservicesManagement.notifications.failedToCreate");
			const message = typeof error === "object" && error && "message" in error
				? String((error as { message?: string }).message)
				: fallback;
			setNotification({
				open: true,
				message,
				severity: "error",
			});
		} finally {
			setFormLoading(false);
		}
	};

	const handleEdit = (service: WebserviceInstance) => {
		setSelectedService(service);

		setFormData({
			name: service.name || "",
			ip: service.ip,
			port: service.port,
			protocol: service.protocol,
			endpoint: service.endpoint || "",
			auto_scaling: service.auto_scaling,
			max_concurrency: service.max_concurrency || 1,
			status: service.status || "inactive",
		});
		setEditDialogOpen(true);
	};

	const handleDelete = async (service: WebserviceInstance) => {
		await confirm({
			type: "delete",
			itemType: "webservice",
			itemName: service.name || service.ip,
			isDangerous: false,
			onConfirm: async () => {
				try {
					await deleteWebservice(service.id);
				} catch (error) {
					if (import.meta.env.DEV) console.error("Failed to delete webservice:", error);
				}
			},
		});
	};

	const getStatusColor = (status: string) => {
		switch (status) {
			case "active":
				return "bg-gray-600 text-white border-gray-700";
			case "inactive":
				return "bg-gray-300 text-gray-800 border-gray-400";
			case "maintenance":
				return "bg-gray-500 text-white border-gray-600";
			default:
				return "bg-gray-100 text-gray-800 border-gray-200";
		}
	};

	const getStatusIcon = (status: string) => {
		switch (status) {
			case "active":
				return <CheckCircle className="w-3 h-3" />;
			case "inactive":
				return <XCircle className="w-3 h-3" />;
			case "maintenance":
				return <Settings className="w-3 h-3" />;
			default:
				return <XCircle className="w-3 h-3" />;
		}
	};

	const renderAvailabilityStatus = (service: WebserviceInstance) => (
		<div className="flex items-center gap-2">
			<div className={`w-2 h-2 rounded-full ${service.available ? 'bg-green-500' : 'bg-gray-400'}`} />
			<span className="text-sm font-medium text-gray-700 dark:text-gray-300">
				{service.available ? t("webservicesManagement.status.online") : t("webservicesManagement.status.offline")}
			</span>
		</div>
	);

	const renderBusyStatus = (service: WebserviceInstance) => {
		const getBusyStatusDisplay = () => {
			// Check if webservice has running models based on current_concurrency
			const isCalculating = service.current_concurrency > 0;

			if (service.available && isCalculating) {
				return (
					<>
						<RotateCw className="w-4 h-4 text-gray-500 dark:text-gray-400 animate-spin" />
						<span className="text-sm text-foreground">{t("webservicesManagement.busyStatus.calculating", { current: service.current_concurrency, max: service.max_concurrency })}</span>
					</>
				);
			}
			if (service.available) {
				return (
					<>
						<Clock className="w-4 h-4 text-gray-500 dark:text-gray-400 dark:text-gray-300" />
						<span className="text-sm text-gray-700 dark:text-gray-300">{t("webservicesManagement.busyStatus.idle", { max: service.max_concurrency })}</span>
					</>
				);
			}
			return <span className="text-sm text-gray-500 dark:text-gray-400">N/A</span>;
		};

		return (
			<div className="flex items-center gap-2">
				{getBusyStatusDisplay()}
			</div>
		);
	};

	if (loading && webservices.length === 0) {
		return (
			<div className="flex justify-center items-center min-h-96">
				<div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-600"></div>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{/* Summary Cards */}
			<div className="grid grid-cols-2 md:grid-cols-5 gap-3">
				{[
					{ icon: Server, label: t("webservicesManagement.summary.total"), value: summary?.total || 0 },
					{ icon: Wifi, label: t("webservicesManagement.summary.online"), value: summary?.online || 0 },
					{ icon: Clock, label: t("webservicesManagement.summary.available"), value: summary?.available || 0 },
					{ icon: RotateCw, label: t("webservicesManagement.summary.busy"), value: summary?.busy || 0 },
					{ icon: WifiOff, label: t("webservicesManagement.summary.offline"), value: summary?.offline || 0 },
				].map((stat) => (
					<div key={stat.label} className="bg-card rounded-lg p-3 border border-border shadow-sm hover:shadow-md transition-all duration-200">
						<div className="flex items-center gap-3">
							<div className="p-2 rounded-lg bg-muted flex-shrink-0">
								<stat.icon className="w-4 h-4 text-muted-foreground" />
							</div>
							<div className="flex-1 min-w-0">
								<p className="text-xs text-muted-foreground font-medium">{stat.label}</p>
								<p className="text-lg font-bold text-foreground">{stat.value}</p>
							</div>
						</div>
					</div>
				))}
			</div>

			{/* User's Queue Status - Show for all users */}
			{(userQueueCount > 0 || userRunningCount > 0) && (
				<div className="bg-gradient-to-r from-primary/5 to-primary/10 rounded-lg p-4 border border-primary/20">
					<div className="flex items-center gap-4">
						<div className="p-3 rounded-full bg-primary/10">
							<Activity className="w-5 h-5 text-primary" />
						</div>
						<div className="flex-1">
							<h3 className="text-sm font-semibold text-foreground">
								{t("webservicesManagement.yourSimulationStatus")}
							</h3>
							<div className="flex flex-col gap-1 mt-1">
								{userRunningCount > 0 && (
									<span className="text-sm text-green-600 dark:text-green-400 flex items-center gap-2">
										<RotateCw className="w-3 h-3 animate-spin" />
										{t("webservicesManagement.modelsRunningDescription", { count: userRunningCount })}
									</span>
								)}
								{userQueueCount > 0 && (
									<span className="text-sm text-amber-600 dark:text-amber-400 flex items-center gap-2">
										<Clock className="w-3 h-3" />
										{t("webservicesManagement.modelsQueuedDescription", { count: userQueueCount })}
									</span>
								)}
							</div>
						</div>
					</div>
				</div>
			)}

			{/* Header with filters */}
			<div className="space-y-4">
				<div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
					<div className="flex items-center gap-3">
						<div className="p-2 bg-muted rounded-lg">
							<Cloud className="w-5 h-5 text-muted-foreground" />
						</div>
						<div>
							<h2 className="text-lg font-semibold text-foreground">{t("webservicesManagement.title")}</h2>
							<p className="text-xs text-muted-foreground">{t("webservicesManagement.subtitle")}</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									onClick={() => {
										setIsRefreshing(true);
										loadWebservices(filters);
										setTimeout(() => setIsRefreshing(false), 1000);
									}}
									disabled={loading}
									className="p-2.5 bg-muted text-muted-foreground rounded-lg hover:bg-muted/80 transition-colors duration-200 disabled:opacity-50"
								>
									<RefreshCw className={`w-4 h-4 transition-transform duration-500 ${loading || isRefreshing ? "animate-spin" : ""}`} />
								</button>
							</TooltipTrigger>
							<TooltipContent>{t("webservicesManagement.refresh")}</TooltipContent>
						</Tooltip>
						{!readOnly && (
							<button
								onClick={() => {
									resetForm();
									setAddDialogOpen(true);
								}}
								className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-all shadow-sm hover:shadow-md"
							>
								<Plus className="w-4 h-4" />
								<span className="hidden sm:inline">{t("webservicesManagement.registerNew")}</span>
								<span className="sm:hidden">{t("common.add")}</span>
							</button>
						)}
					</div>
				</div>

				{/* Filters */}
				<div className="flex flex-col sm:flex-row gap-3">
					<div className="relative flex-1">
						<Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
						<input
							type="text"
							placeholder={t("webservicesManagement.searchPlaceholder")}
							value={searchInput}
							onChange={(e) => setSearchInput(e.target.value)}
							className="w-full pl-10 pr-4 py-2.5 border border-input rounded-xl focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent bg-background text-sm text-foreground"
						/>
					</div>
					<div className="flex gap-2">
						<FilterDropdown
							options={[
								{ value: "", label: t("webservicesManagement.filters.allStatus") },
								{ value: "active", label: t("webservicesManagement.filters.active"), icon: <CheckCircle className="w-3.5 h-3.5 text-green-500" /> },
								{ value: "inactive", label: t("webservicesManagement.filters.inactive"), icon: <XCircle className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300" /> },
								{ value: "maintenance", label: t("webservicesManagement.filters.maintenance"), icon: <Settings className="w-3.5 h-3.5 text-yellow-500" /> },
								{ value: "error", label: t("webservicesManagement.filters.error"), icon: <XCircle className="w-3.5 h-3.5 text-red-500" /> },
							]}
							value={filters.status || ""}
							onChange={(value) => setFilters({ ...filters, status: value })}
							placeholder={t("webservicesManagement.filters.allStatus")}
							icon={<Activity className="w-3.5 h-3.5 text-muted-foreground" />}
						/>
						<FilterDropdown
							options={[
								{ value: "", label: t("webservicesManagement.filters.allAvailability") },
								{ value: "true", label: t("webservicesManagement.filters.available"), icon: <Wifi className="w-3.5 h-3.5 text-green-500" /> },
								{ value: "false", label: t("webservicesManagement.filters.unavailable"), icon: <WifiOff className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300" /> },
							]}
							value={filters.available || ""}
							onChange={(value) => setFilters({ ...filters, available: value })}
							placeholder={t("webservicesManagement.filters.allAvailability")}
							icon={<Wifi className="w-3.5 h-3.5 text-muted-foreground" />}
						/>
					</div>
				</div>
			</div>

			{/* Table */}
			<div className="bg-card rounded-xl border border-border overflow-hidden shadow-sm">
				{loading && (
					<div className="h-1 bg-muted overflow-hidden">
						<div className="h-full w-1/3 bg-gradient-to-r from-blue-400 to-blue-600 animate-[shimmer_1.5s_infinite]"></div>
					</div>
				)}
				<div className="overflow-x-auto">
					<table className="min-w-full divide-y divide-border">
						<thead className="bg-muted/50">
							<tr>
								<th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("webservicesManagement.table.service")}</th>
								{!readOnly && (
									<th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("webservicesManagement.table.endpoint")}</th>
								)}
								<th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("webservicesManagement.table.status")}</th>
								<th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("webservicesManagement.table.availability")}</th>
								<th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("webservicesManagement.table.jobs")}</th>
								<th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("webservicesManagement.table.performance")}</th>
								<th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("webservicesManagement.table.user")}</th>
								<th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("webservicesManagement.table.lastCheck")}</th>
								<th className="px-6 py-4 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("webservicesManagement.table.actions")}</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-border">
							{webservices.length === 0 && !loading ? (
								<tr>
									<td colSpan={readOnly ? 8 : 9} className="px-6 py-16 text-center">
										<div className="flex flex-col items-center justify-center gap-3">
											<div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-2xl flex items-center justify-center">
												<Cloud className="w-8 h-8 text-gray-400 dark:text-gray-300" />
											</div>
											<div>
												<h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">{t("webservicesManagement.noWebservicesFound")}</h3>
												<p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
													{readOnly 
														? t("webservicesManagement.noWebservicesAvailable") 
														: t("webservicesManagement.noWebservicesDescription")}
												</p>
											</div>
											{!readOnly && (
												<button
													onClick={() => {
														resetForm();
														setAddDialogOpen(true);
													}}
													className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-all shadow-sm hover:shadow-md"
												>
													<Plus className="w-4 h-4" />
													{t("webservicesManagement.registerNew")}
												</button>
											)}
										</div>
									</td>
								</tr>
							) : (
								webservices
									.slice(currentPage * itemsPerPage, (currentPage + 1) * itemsPerPage)
									.map((service) => (
									<tr key={service.id} className="hover:bg-muted/50 transition-colors duration-150">
										<td className="px-6 py-4">
											<div className="flex items-center gap-3">
												<div className="w-10 h-10 rounded-lg flex items-center justify-center bg-muted">
													<Server className="w-5 h-5 text-muted-foreground" />
												</div>
												<div className="text-sm font-medium text-foreground">
													{service.name || `${t("webservicesManagement.table.service")} ${service.id}`}
												</div>
											</div>
										</td>
										{!readOnly && (
											<td className="px-6 py-4">
												<div>
													<div className="text-sm font-mono text-foreground">
														{service.protocol}://{service.ip}:{service.port}
													</div>
													{service.endpoint && (
														<div className="text-xs text-muted-foreground">{service.endpoint}</div>
													)}
												</div>
											</td>
										)}
										<td className="px-6 py-4">
											<span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${getStatusColor(service.status)}`}>
												{getStatusIcon(service.status)}
												{service.status.charAt(0).toUpperCase() + service.status.slice(1)}
											</span>
										</td>
										<td className="px-6 py-4">{renderAvailabilityStatus(service)}</td>
										<td className="px-6 py-4">{renderBusyStatus(service)}</td>
										<td className="px-6 py-4">
											<div className="space-y-1.5">
												<div className="flex items-center gap-2">
													<Cpu className="w-3.5 h-3.5 text-muted-foreground" />
													<div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden w-16">
														<div 
															className="h-full bg-gradient-to-r from-blue-400 to-blue-600 rounded-full transition-all"
															style={{ width: `${service.cpu_usage ?? 0}%` }}
														></div>
													</div>
													<span className="text-xs text-muted-foreground w-10">
														{service.cpu_usage !== null && service.cpu_usage !== undefined ? `${service.cpu_usage.toFixed(0)}%` : 'N/A'}
													</span>
												</div>
												<div className="flex items-center gap-2">
													<HardDrive className="w-3.5 h-3.5 text-muted-foreground" />
													<div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden w-16">
														<div 
															className="h-full bg-gradient-to-r from-purple-400 to-purple-600 rounded-full transition-all"
															style={{ width: `${service.memory_usage ?? 0}%` }}
														></div>
													</div>
													<span className="text-xs text-muted-foreground w-10">
														{service.memory_usage !== null && service.memory_usage !== undefined ? `${service.memory_usage.toFixed(0)}%` : 'N/A'}
													</span>
												</div>
											</div>
										</td>
										<td className="px-6 py-4">
											<span className="text-sm text-foreground">
												{service.user ? service.user.name : "-"}
											</span>
										</td>
										<td className="px-6 py-4">
											<span className="text-xs text-muted-foreground">
												{service.last_check ? formatDateTime24h(service.last_check) : t("webservicesManagement.table.never")}
											</span>
										</td>
										<td className="px-6 py-4">
											<div className="flex items-center justify-end gap-3">
												{/* Concurrency Indicator */}
												<Tooltip>
													<TooltipTrigger asChild>
														<div className="flex items-center gap-1.5 px-2.5 py-1.5 bg-muted text-foreground rounded-lg border border-border cursor-default">
															<Activity className="w-3.5 h-3.5 text-muted-foreground" />
															<span className="text-xs font-medium">
																{service.current_concurrency}/{service.max_concurrency}
															</span>
														</div>
													</TooltipTrigger>
													<TooltipContent>
														<p className="text-sm">
															{t("common.current")}: <span className="font-semibold">{service.current_concurrency}</span> / {t("common.max")}: <span className="font-semibold">{service.max_concurrency}</span>
														</p>
													</TooltipContent>
												</Tooltip>
												
												{!readOnly && (
													<ModelActionGroup
														actions={[
															{
																key: "ping",
																icon: Zap,
																tooltip: t("webservicesManagement.actions.pingWebservice"),
																variant: service.available ? "success" : "warning",
																onClick: () => {
																	void handleServiceAction(service.id, "ping", service.name || service.ip);
																},
															},
															{
																key: "edit",
																icon: Edit,
																tooltip: t("webservicesManagement.actions.editWebservice"),
																variant: "default",
																onClick: () => handleEdit(service),
															},
															{
																key: "delete",
																icon: Trash2,
																tooltip: t("webservicesManagement.actions.deleteWebservice"),
																variant: "danger",
																onClick: () => { void handleDelete(service); },
																disabled: service.busy,
															},
														]}
														layout="horizontal"
														size="small"
													/>
												)}
											</div>
										</td>
									</tr>
								))
							)}
						</tbody>
					</table>
				</div>
				
				<Pagination
					currentPage={currentPage}
					totalItems={webservices.length}
					itemsPerPage={itemsPerPage}
					onPageChange={setCurrentPage}
					onItemsPerPageChange={(newItemsPerPage: number) => {
						setItemsPerPage(newItemsPerPage);
						setCurrentPage(0);
					}}
					isLoading={loading}
				/>
			</div>

			<UniversalForm
				isOpen={addDialogOpen || editDialogOpen}
				onClose={() => {
					setAddDialogOpen(false);
					setEditDialogOpen(false);
					resetForm();
				}}
				title={
					selectedService ? t("webservicesManagement.dialog.editTitle") : t("webservicesManagement.dialog.createTitle")
				}
				description={
					selectedService
						? t("webservicesManagement.dialog.editDescription")
						: t("webservicesManagement.dialog.createDescription")
				}
				variant="webservice"
				sections={getWebserviceFormSections(t)}
				values={formData as unknown as Record<string, FormDataConvertible>}
				onChange={handleFormChange}
				onSubmit={handleSaveWebservice}
				submitText={
					selectedService ? t("webservicesManagement.dialog.editButton") : t("webservicesManagement.dialog.createButton")
				}
				loading={formLoading}
				errors={formErrors}
				maxWidth="xl"
			/>

			<div className="fixed top-16 right-4 z-[9999]">
				<Notification
					isOpen={notification.open}
					message={notification.message}
					severity={notification.severity}
					onClose={() => setNotification({ ...notification, open: false })}
				/>
			</div>
		</div>
	);
};


export default WebservicesManagement;
