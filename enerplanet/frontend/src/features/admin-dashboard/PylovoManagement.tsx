import React, { useState, useEffect, useRef } from "react";
import Notification from "@/components/ui/Notification";
import { useConfirm } from "@/hooks/useConfirmDialog";
import { UniversalForm } from "@spatialhub/forms";
import { getPylovoFormSections, validatePylovoForm } from "@/configuration/formConfigurations";
import ModelActionGroup from "@/components/shared/ModelActionGroup";
import { Tooltip, TooltipTrigger, TooltipContent } from "@spatialhub/ui";
import { FilterDropdown } from "@/components/ui/FilterDropdown";
import Pagination from "@/components/ui/Pagination";
import { PylovoFilters, PylovoFormData, PylovoInstance } from "@/features/admin-dashboard/types";
import type { FormDataConvertible } from "@/hooks/useForm";
import { usePylovo } from "@/features/admin-dashboard/hooks/usePylovo";
import { formatDateTime24h } from "@/utils/dateHelpers";
import { useTranslation } from "@spatialhub/i18n";
import {
	Plus,
	RefreshCw,
	Edit,
	Trash2,
	CheckCircle,
	Search,
	Settings,
	XCircle,
	Zap,
	Clock,
	Activity,
	Server,
	Wifi,
	WifiOff,
	Star,
} from "lucide-react";

interface PylovoManagementProps {
	readOnly?: boolean;
}

interface NotificationState {
	open: boolean;
	message: string;
	severity: "success" | "error" | "warning";
}

const PylovoManagement: React.FC<PylovoManagementProps> = ({ readOnly = false }) => {
	const { t } = useTranslation();

	const {
		instances,
		loading,
		error,
		summary,
		loadInstances,
		createInstance,
		updateInstance,
		deleteInstance,
		setPrimary,
		markAvailable,
		markUnavailable,
		pingInstance,
	} = usePylovo(
		{},
		{
			autoRefresh: true,
			refreshInterval: 30000,
		}
	);

	const [addDialogOpen, setAddDialogOpen] = useState(false);
	const [editDialogOpen, setEditDialogOpen] = useState(false);
	const [selectedInstance, setSelectedInstance] = useState<PylovoInstance | null>(null);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const confirm = useConfirm();

	const [notification, setNotification] = useState<NotificationState>({
		open: false,
		message: "",
		severity: "success",
	});

	const [formData, setFormData] = useState<PylovoFormData>({
		name: "",
		ip: "",
		port: 80,
		protocol: "http",
		endpoint: "",
		status: "active",
	});
	const [formErrors, setFormErrors] = useState<Record<string, string>>({});
	const [formLoading, setFormLoading] = useState(false);

	const [filters, setFilters] = useState<PylovoFilters>({
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
		loadInstances();
	}, [loadInstances]);

	useEffect(() => {
		setCurrentPage(0);
	}, [filters.status, filters.available, filters.search]);

	useEffect(() => {
		if (error) {
			setNotification({
				open: true,
				message: error,
				severity: "error",
			});
		}
	}, [error]);

	const filteredInstances = instances.filter((instance) => {
		if (filters.status && instance.status !== filters.status) return false;
		if (filters.available === "true" && !instance.available) return false;
		if (filters.available === "false" && instance.available) return false;
		if (filters.search) {
			const search = filters.search.toLowerCase();
			const nameMatch = instance.name?.toLowerCase().includes(search);
			const ipMatch = instance.ip?.toLowerCase().includes(search);
			if (!nameMatch && !ipMatch) return false;
		}
		return true;
	});

	const handleInstanceAction = async (instanceId: number, action: string, instanceName?: string) => {
		try {
			switch (action) {
				case "mark_available":
					await markAvailable(instanceId);
					break;
				case "mark_unavailable":
					await markUnavailable(instanceId);
					break;
				case "set_primary":
					await setPrimary(instanceId);
					setNotification({
						open: true,
						message: t("pylovoManagement.notifications.primarySet"),
						severity: "success",
					});
					return;
				case "ping": {
					const pingResult = await pingInstance(instanceId);
					const isAvailable = pingResult?.available;
					const status = isAvailable ? t("pylovoManagement.status.available") : t("pylovoManagement.status.unavailable");
					const serviceLabel = instanceName || `${t("pylovoManagement.table.service")} ${instanceId}`;

					setNotification({
						open: true,
						message: `${t("pylovoManagement.healthCheck")}: ${serviceLabel} - ${status}`,
						severity: isAvailable ? "success" : "warning",
					});
					return;
				}
				default:
					return;
			}

			setNotification({
				open: true,
				message: t("pylovoManagement.notifications.statusChanged", { status: action.replace("_", " ") }),
				severity: "success",
			});
		} catch (err: unknown) {
			const fallbackMessage = action === "ping"
				? t("pylovoManagement.notifications.failedToPing")
				: t("pylovoManagement.notifications.failedToUpdate");
			const message = typeof err === 'object' && err && 'message' in err ? String((err as { message?: string }).message) : fallbackMessage;
			setNotification({ open: true, message, severity: "error" });
		}
	};

	const resetForm = () => {
		setFormData({
			name: "",
			ip: "",
			port: 80,
			protocol: "http",
			endpoint: "",
			status: "active",
		});
		setFormErrors({});
		setSelectedInstance(null);
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

	const handleSaveInstance = async () => {
		setFormLoading(true);
		setFormErrors({});

		try {
			const errors = validatePylovoForm(formData as unknown as Record<string, unknown>, t);

			if (Object.keys(errors).length > 0) {
				setFormErrors(errors);
				return;
			}

			const apiData = {
				name: formData.name,
				ip: formData.ip,
				port: formData.port,
				protocol: formData.protocol,
				endpoint: formData.endpoint || undefined,
				status: formData.status,
			};

			if (selectedInstance) {
				await updateInstance(selectedInstance.id, apiData);
			} else {
				await createInstance(apiData);
			}

			setAddDialogOpen(false);
			setEditDialogOpen(false);
			resetForm();
			setNotification({
				open: true,
				message: selectedInstance ? t("pylovoManagement.notifications.updated") : t("pylovoManagement.notifications.created"),
				severity: "success",
			});
		} catch (err: unknown) {
			const fallback = selectedInstance ? t("pylovoManagement.notifications.failedToUpdate") : t("pylovoManagement.notifications.failedToCreate");
			const message = typeof err === "object" && err && "message" in err
				? String((err as { message?: string }).message)
				: fallback;
			setNotification({ open: true, message, severity: "error" });
		} finally {
			setFormLoading(false);
		}
	};

	const handleEdit = (instance: PylovoInstance) => {
		setSelectedInstance(instance);
		setFormData({
			name: instance.name || "",
			ip: instance.ip,
			port: instance.port,
			protocol: instance.protocol,
			endpoint: instance.endpoint || "",
			status: instance.status || "active",
		});
		setEditDialogOpen(true);
	};

	const handleDelete = async (instance: PylovoInstance) => {
		await confirm({
			type: "delete",
			itemType: "pylovo instance",
			itemName: instance.name || instance.ip,
			isDangerous: false,
			onConfirm: async () => {
				try {
					await deleteInstance(instance.id);
				} catch (err) {
					if (import.meta.env.DEV) console.error("Failed to delete pylovo instance:", err);
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

	const renderAvailabilityStatus = (instance: PylovoInstance) => (
		<div className="flex items-center gap-2">
			<div className={`w-2 h-2 rounded-full ${instance.available ? 'bg-green-500' : 'bg-gray-400'}`} />
			<span className="text-sm font-medium text-gray-700 dark:text-gray-300">
				{instance.available ? t("pylovoManagement.status.online") : t("pylovoManagement.status.offline")}
			</span>
		</div>
	);

	if (loading && instances.length === 0) {
		return (
			<div className="flex justify-center items-center min-h-96">
				<div className="animate-spin rounded-full h-12 w-12 border-b-2 border-gray-600"></div>
			</div>
		);
	}

	return (
		<div className="space-y-6">
			{/* Summary Cards */}
			<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
				{[
					{ icon: Server, label: t("pylovoManagement.summary.total"), value: summary?.total || 0 },
					{ icon: Wifi, label: t("pylovoManagement.summary.online"), value: summary?.online || 0 },
					{ icon: Clock, label: t("pylovoManagement.summary.available"), value: summary?.available || 0 },
					{ icon: WifiOff, label: t("pylovoManagement.summary.offline"), value: summary?.offline || 0 },
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

			{/* Header with filters */}
			<div className="space-y-4">
				<div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
					<div className="flex items-center gap-3">
						<div className="p-2 bg-muted rounded-lg">
							<Activity className="w-5 h-5 text-muted-foreground" />
						</div>
						<div>
							<h2 className="text-lg font-semibold text-foreground">{t("pylovoManagement.title")}</h2>
							<p className="text-xs text-muted-foreground">{t("pylovoManagement.subtitle")}</p>
						</div>
					</div>
					<div className="flex items-center gap-2">
						<Tooltip>
							<TooltipTrigger asChild>
								<button
									onClick={() => {
										setIsRefreshing(true);
										loadInstances();
										setTimeout(() => setIsRefreshing(false), 1000);
									}}
									disabled={loading}
									className="p-2.5 bg-muted text-muted-foreground rounded-lg hover:bg-muted/80 transition-colors duration-200 disabled:opacity-50"
								>
									<RefreshCw className={`w-4 h-4 transition-transform duration-500 ${loading || isRefreshing ? "animate-spin" : ""}`} />
								</button>
							</TooltipTrigger>
							<TooltipContent>{t("pylovoManagement.refresh")}</TooltipContent>
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
								<span className="hidden sm:inline">{t("pylovoManagement.registerNew")}</span>
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
							placeholder={t("pylovoManagement.searchPlaceholder")}
							value={searchInput}
							onChange={(e) => setSearchInput(e.target.value)}
							className="w-full pl-10 pr-4 py-2.5 border border-input rounded-xl focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent bg-background text-sm text-foreground"
						/>
					</div>
					<div className="flex gap-2">
						<FilterDropdown
							options={[
								{ value: "", label: t("pylovoManagement.filters.allStatus") },
								{ value: "active", label: t("pylovoManagement.filters.active"), icon: <CheckCircle className="w-3.5 h-3.5 text-green-500" /> },
								{ value: "inactive", label: t("pylovoManagement.filters.inactive"), icon: <XCircle className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300" /> },
								{ value: "maintenance", label: t("pylovoManagement.filters.maintenance"), icon: <Settings className="w-3.5 h-3.5 text-yellow-500" /> },
							]}
							value={filters.status || ""}
							onChange={(value) => setFilters({ ...filters, status: value })}
							placeholder={t("pylovoManagement.filters.allStatus")}
							icon={<Activity className="w-3.5 h-3.5 text-muted-foreground" />}
						/>
						<FilterDropdown
							options={[
								{ value: "", label: t("pylovoManagement.filters.allAvailability") },
								{ value: "true", label: t("pylovoManagement.filters.available"), icon: <Wifi className="w-3.5 h-3.5 text-green-500" /> },
								{ value: "false", label: t("pylovoManagement.filters.unavailable"), icon: <WifiOff className="w-3.5 h-3.5 text-gray-400 dark:text-gray-300" /> },
							]}
							value={filters.available || ""}
							onChange={(value) => setFilters({ ...filters, available: value })}
							placeholder={t("pylovoManagement.filters.allAvailability")}
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
								<th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("pylovoManagement.table.service")}</th>
								{!readOnly && (
									<th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("pylovoManagement.table.endpoint")}</th>
								)}
								<th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("pylovoManagement.table.status")}</th>
								<th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("pylovoManagement.table.availability")}</th>
								<th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("pylovoManagement.table.primary")}</th>
								<th className="px-6 py-4 text-left text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("pylovoManagement.table.lastCheck")}</th>
								<th className="px-6 py-4 text-right text-xs font-semibold text-muted-foreground uppercase tracking-wider">{t("pylovoManagement.table.actions")}</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-border">
							{filteredInstances.length === 0 && !loading ? (
								<tr>
									<td colSpan={readOnly ? 6 : 7} className="px-6 py-16 text-center">
										<div className="flex flex-col items-center justify-center gap-3">
											<div className="w-16 h-16 bg-gray-100 dark:bg-gray-700 rounded-2xl flex items-center justify-center">
												<Activity className="w-8 h-8 text-gray-400 dark:text-gray-300" />
											</div>
											<div>
												<h3 className="text-lg font-medium text-gray-900 dark:text-white mb-1">{t("pylovoManagement.noInstancesFound")}</h3>
												<p className="text-sm text-gray-500 dark:text-gray-400 mb-4">
													{readOnly
														? t("pylovoManagement.noInstancesAvailable")
														: t("pylovoManagement.noInstancesDescription")}
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
													{t("pylovoManagement.registerNew")}
												</button>
											)}
										</div>
									</td>
								</tr>
							) : (
								filteredInstances
									.slice(currentPage * itemsPerPage, (currentPage + 1) * itemsPerPage)
									.map((instance) => (
									<tr key={instance.id} className="hover:bg-muted/50 transition-colors duration-150">
										<td className="px-6 py-4">
											<div className="flex items-center gap-3">
												<div className="w-10 h-10 rounded-lg flex items-center justify-center bg-muted">
													<Server className="w-5 h-5 text-muted-foreground" />
												</div>
												<div className="text-sm font-medium text-foreground">
													{instance.name || `${t("pylovoManagement.table.service")} ${instance.id}`}
												</div>
											</div>
										</td>
										{!readOnly && (
											<td className="px-6 py-4">
												<div>
													<div className="text-sm font-mono text-foreground">
														{instance.protocol}://{instance.ip}:{instance.port}
													</div>
													{instance.endpoint && (
														<div className="text-xs text-muted-foreground">{instance.endpoint}</div>
													)}
												</div>
											</td>
										)}
										<td className="px-6 py-4">
											<span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-xs font-medium ${getStatusColor(instance.status)}`}>
												{getStatusIcon(instance.status)}
												{instance.status.charAt(0).toUpperCase() + instance.status.slice(1)}
											</span>
										</td>
										<td className="px-6 py-4">{renderAvailabilityStatus(instance)}</td>
										<td className="px-6 py-4">
											<Tooltip>
												<TooltipTrigger asChild>
													<button
														onClick={() => !readOnly && void handleInstanceAction(instance.id, "set_primary")}
														disabled={readOnly || instance.is_primary}
														className={`p-1.5 rounded-lg transition-colors ${
															instance.is_primary
																? "text-yellow-500"
																: readOnly
																? "text-gray-300 dark:text-gray-600 cursor-default"
																: "text-gray-300 dark:text-gray-600 hover:text-yellow-400 cursor-pointer"
														}`}
													>
														<Star className={`w-5 h-5 ${instance.is_primary ? "fill-current" : ""}`} />
													</button>
												</TooltipTrigger>
												<TooltipContent>
													{instance.is_primary
														? t("pylovoManagement.actions.currentPrimary")
														: t("pylovoManagement.actions.setPrimary")}
												</TooltipContent>
											</Tooltip>
										</td>
										<td className="px-6 py-4">
											<span className="text-xs text-muted-foreground">
												{instance.last_check ? formatDateTime24h(instance.last_check) : t("pylovoManagement.table.never")}
											</span>
										</td>
										<td className="px-6 py-4">
											<div className="flex items-center justify-end gap-3">
												{!readOnly && (
													<ModelActionGroup
														actions={[
															{
																key: "ping",
																icon: Zap,
																tooltip: t("pylovoManagement.actions.pingInstance"),
																variant: instance.available ? "success" : "warning",
																onClick: () => {
																	void handleInstanceAction(instance.id, "ping", instance.name || instance.ip);
																},
															},
															{
																key: "edit",
																icon: Edit,
																tooltip: t("pylovoManagement.actions.editInstance"),
																variant: "default",
																onClick: () => handleEdit(instance),
															},
															{
																key: "delete",
																icon: Trash2,
																tooltip: t("pylovoManagement.actions.deleteInstance"),
																variant: "danger",
																onClick: () => { void handleDelete(instance); },
																disabled: instance.is_primary,
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
					totalItems={filteredInstances.length}
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
					selectedInstance ? t("pylovoManagement.dialog.editTitle") : t("pylovoManagement.dialog.createTitle")
				}
				description={
					selectedInstance
						? t("pylovoManagement.dialog.editDescription")
						: t("pylovoManagement.dialog.createDescription")
				}
				variant="default"
				sections={getPylovoFormSections(t)}
				values={formData as unknown as Record<string, FormDataConvertible>}
				onChange={handleFormChange}
				onSubmit={handleSaveInstance}
				submitText={
					selectedInstance ? t("pylovoManagement.dialog.editButton") : t("pylovoManagement.dialog.createButton")
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

export default PylovoManagement;
