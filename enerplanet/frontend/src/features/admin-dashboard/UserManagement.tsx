import { useState, useEffect, useCallback } from "react";
import { UserPlus, Edit, Trash2, Users, RefreshCw, Shield, Mail, Building, Briefcase, Phone, UserCheck, UserX, Copy, Check, UserCog, CheckCircle, XCircle, FolderInput } from "lucide-react";
import { useAuthStore } from "@/store/auth-store";
import { useNavigate, type NavigateFunction } from "react-router-dom";
import axios from "@/lib/axios";
import Notification from "@/components/ui/Notification";
import { Tooltip, TooltipTrigger, TooltipContent } from "@spatialhub/ui";
import type { FormDataConvertible } from "@/hooks/useForm";
import { useConfirm } from "@/hooks/useConfirmDialog";
import Pagination from "@/components/ui/Pagination";
import { UniversalForm } from "@spatialhub/forms";
import { getUserFormSections, validateUserForm } from "@/configuration/formConfigurations";
import ModelActionGroup from "@/components/shared/ModelActionGroup";
import { GroupManagement } from "./GroupManagement";
import { GroupSelector } from "@/components/group/GroupSelector";
import { groupService, type Group } from "@/components/workspace/services/groupService";
import { getGroupDisplayName, getGroupFullDisplayName } from "@/components/workspace/utils/groupUtils";
import { useNotification } from "@/features/notifications/hooks/useNotification";
import { useDebounce } from "@/hooks/useDebounce";
import { useDialog } from "@/hooks/useDialog";
import StatusBadge from "@/components/ui/StatusBadge";
import { TableIconCell } from "@/components/table/TableIconCell";
import { getAccessLevelColor, getAccessLevelName, getAccessLevelIconColor, isExpert, isManager, isExpertOrManager } from "@/features/admin-dashboard/utils/accessLevelUtils";
import { getPaginationParams, filterByGroup, paginateArray } from "@/utils/paginationUtils";
import { useTranslation } from "@spatialhub/i18n";
import { useUserSelection } from "@/features/admin-dashboard/hooks/useUserSelection";

function getUsersEmptyMessage(t: (key: string, params?: Record<string, string>) => string, user: User | null | undefined, noResults: boolean, search: string): string {
	if (user && isManager(user)) {
		return t("userManagement.noUsersInGroup");
	}
	if (noResults) {
		return t("userManagement.noUsersMatch", { search });
	}
	return t("userManagement.noUsersFound");
}


interface User {
	id: string | number;
	name: string;
	email: string;
	email_verified?: boolean;
	enabled?: boolean;
	organization?: string;
	position?: string;
	phone?: string;
	access_level: "very_low" | "intermediate" | "manager" | "expert";
	group_id?: string;
	model_limit?: number;
	created_at?: number;
}

interface UserFormData {
	name: string;
	email: string;
	organization: string;
	position: string;
	phone: string;
	access_level: "very_low" | "intermediate" | "manager" | "expert";
	email_verified?: boolean;
	password?: string;
	password_confirmation?: string;
	model_limit?: number | string;
}

interface ApiResponse<T> {
	success: boolean;
	message: string;
	data?: T;
	users?: T;
	errors?: Record<string, string>;
}

interface Notification {
	open: boolean;
	message: string;
	severity: "success" | "error" | "warning" | "info";
}

type CreateUserPayload = {
	email: string;
	name: string;
	password?: string;
	access_level: User["access_level"];
	organization: string;
	position: string;
	phone: string;
	group_id?: Group["id"];
};

type UserDialogState = Pick<ReturnType<typeof useDialog<User>>, "selectedItem" | "close">;

interface UserManagementProps {
	onUsersMutated?: () => void;
}

export const UserManagement = ({ onUsersMutated }: UserManagementProps) => {
	const { t } = useTranslation();
	const { user } = useAuthStore();
	const navigate = useNavigate();
	const [users, setUsers] = useState<User[]>([]);
	const [loading, setLoading] = useState(false);
	const [isRefreshing, setIsRefreshing] = useState(false);
	const [page, setPage] = useState(0);
	const [rowsPerPage, setRowsPerPage] = useState(10);
	const [totalCount, setTotalCount] = useState(0);
	const editDialog = useDialog<User>();
	const addDialog = useDialog();
	const groupManagementDialog = useDialog();
	const changeGroupDialog = useDialog<User>();
	const renameGroupDialog = useDialog<Group>();

	const [groups, setGroups] = useState<Group[]>([]);
	const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
	const [groupReloadKey, setGroupReloadKey] = useState(0);
	const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
	const [selectedGroupDisabled, setSelectedGroupDisabled] = useState<boolean | null>(null);
	const [groupNewName, setGroupNewName] = useState<string>('');

	const confirm = useConfirm();

	const {
		selectedUsers,
		isSelected,
		handleSelectUser,
		handleSelectAll,
		clearSelection,
	} = useUserSelection<User>();

	const bulkChangeGroupDialog = useDialog();
	const [bulkSelectedGroupId, setBulkSelectedGroupId] = useState<string | null>(null);

	const [formData, setFormData] = useState<UserFormData>({
		name: "",
		email: "",
		organization: "",
		position: "",
		phone: "",
		access_level: "very_low",
		email_verified: false,
		password: "",
		password_confirmation: "",
		model_limit: undefined,
	});
	const { notification, showSuccess, showError, hide: hideNotification, setNotification } = useNotification();
	const [formErrors, setFormErrors] = useState<Record<string, string>>({});
	const [formLoading, setFormLoading] = useState(false);

	const [searchTerm, setSearchTerm] = useState("");
	const debouncedSearch = useDebounce(searchTerm.trim(), 400);
	const [copiedEmail, setCopiedEmail] = useState<string | null>(null);

	const handleCopyEmail = useCallback((email: string) => {
		navigator.clipboard.writeText(email).then(() => {
			setCopiedEmail(email);
			setTimeout(() => setCopiedEmail(null), 2000);
		}).catch(() => {
			showError(t("userManagement.notifications.failedToCopyEmail"));
		});
	}, [showError, t]);

	useEffect(() => { setPage(0); }, [debouncedSearch]);

	useEffect(() => { setPage(0); }, [selectedGroup]);

	// Clear selection when filters/page change to prevent stale references
	useEffect(() => { clearSelection(); }, [debouncedSearch, selectedGroup, page, clearSelection]);

	const fetchUsers = useCallback(async () => {
		await fetchUsersWithPagination({
			user,
			selectedGroup,
			debouncedSearch,
			page,
			rowsPerPage,
			setUsers,
			setTotalCount,
			setLoading,
			setNotification,
			navigate
		});
	}, [debouncedSearch, page, rowsPerPage, selectedGroup, user, navigate, setNotification]);

	const createUser = async (userData: UserFormData): Promise<boolean> => {
		try {
			const payload: CreateUserPayload = {
				email: userData.email,
				name: userData.name,
				password: userData.password || undefined,
				access_level: userData.access_level,
				organization: userData.organization,
				position: userData.position,
				phone: userData.phone,
			};

			if ((isManager(user) || isExpert(user)) && selectedGroup) {
				payload.group_id = selectedGroup.id;
			}

			const response = await axios.post("/users", payload);
			const data: ApiResponse<User> = response.data;

			if (data.success) {
				await new Promise(resolve => setTimeout(resolve, 200));
				await fetchUsers();
				setNotification({ open: true, message: t("userManagement.notifications.userCreated"), severity: "success" });
				if (onUsersMutated) onUsersMutated();
				return true;
			} else {
				throw new Error(data.message || t("userManagement.notifications.failedToCreate"));
			}
		} catch (error: unknown) {
			if (import.meta.env.DEV) console.error("Error creating user:", error);
			setNotification({ open: true, message: t("userManagement.notifications.failedToCreate"), severity: "error" });
			return false;
		}
	};

	const updateUser = async (userId: string | number, userData: Partial<UserFormData>): Promise<boolean> => {
		try {
			const updateData = { ...userData };
			if (!updateData.password) {
				delete updateData.password;
				delete updateData.password_confirmation;
			}

			if (updateData.email_verified !== true) {
				delete (updateData as Partial<UserFormData> & Record<string, unknown>)["email_verified"];
			}

			// When model_limit is blank, reset to default for the user's access level
			if (updateData.model_limit === "" || updateData.model_limit === undefined) {
				const level = (updateData.access_level || formData.access_level || "very_low") as string;
				const defaults: Record<string, number> = { very_low: 10, intermediate: 25, manager: 50, expert: 0 };
				updateData.model_limit = defaults[level] ?? 10;
			}

			const response = await axios.put(`/users/${userId}`, updateData);
			const data: ApiResponse<User> = response.data;

			if (data.success) {
				await new Promise(resolve => setTimeout(resolve, 500));
				await fetchUsers();
				setNotification({ open: true, message: t("userManagement.notifications.userUpdated"), severity: "success" });
				if (onUsersMutated) onUsersMutated();
				return true;
			} else {
				throw new Error(data.message || t("userManagement.notifications.failedToUpdate"));
			}
		} catch (error: unknown) {
			if (import.meta.env.DEV) console.error("Error updating user:", error);
			setNotification({ open: true, message: t("userManagement.notifications.failedToUpdate"), severity: "error" });
			return false;
		}
	};

	const deleteUser = async (userId: string | number): Promise<boolean> => {
		try {
			const response = await axios.delete(`/users/${userId}`);
			const data: ApiResponse<null> = response.data;

			if (data.success) {
				await fetchUsers();
				setNotification({ open: true, message: t("userManagement.notifications.userDeleted"), severity: "success" });
				if (onUsersMutated) onUsersMutated();
				return true;
			} else {
				throw new Error(data.message || t("userManagement.notifications.failedToDelete"));
			}
		} catch (error) {
			if (import.meta.env.DEV) console.error("Error deleting user:", error);
			setNotification({ open: true, message: t("userManagement.notifications.failedToDelete"), severity: "error" });
			return false;
		}
	};

	const disableUser = async (userId: string | number): Promise<boolean> => {
		try {
			const response = await axios.put(`/users/${userId}/disable`);
			const data: ApiResponse<null> = response.data;
			if (data.success) {
				await fetchUsers();
				setNotification({ open: true, message: t("userManagement.notifications.userDisabled"), severity: "success" });
				if (onUsersMutated) onUsersMutated();
				return true;
			} else {
				throw new Error(data.message || t("userManagement.notifications.failedToDisable"));
			}
		} catch (error) {
			if (import.meta.env.DEV) console.error("Error disabling user:", error);
			setNotification({ open: true, message: t("userManagement.notifications.failedToDisable"), severity: "error" });
			return false;
		}
	};

	const enableUser = async (userId: string | number): Promise<boolean> => {
		try {
			const response = await axios.put(`/users/${userId}/enable`);
			const data: ApiResponse<null> = response.data;
			if (data.success) {
				await fetchUsers();
				setNotification({ open: true, message: t("userManagement.notifications.userEnabled"), severity: "success" });
				if (onUsersMutated) onUsersMutated();
				return true;
			} else {
				throw new Error(data.message || t("userManagement.notifications.failedToEnable"));
			}
		} catch (error) {
			if (import.meta.env.DEV) console.error("Error enabling user:", error);
			setNotification({ open: true, message: t("userManagement.notifications.failedToEnable"), severity: "error" });
			return false;
		}
	};

	const handleDisableUser = async (u: User) => {
		try {
			await confirm({
				type: "warning",
				itemType: "user",
				itemName: `${u.name} (${u.email})`,
				description: t("userManagement.confirmations.disableUserDescription"),
				onConfirm: async () => { await disableUser(u.id); },
			});
		} catch {
			// User cancelled the action
		}
	};

	const handleEnableUser = async (u: User) => {
		try {
			await confirm({
				type: "success",
				itemType: "user",
				itemName: `${u.name} (${u.email})`,
				description: t("userManagement.confirmations.enableUserDescription"),
				onConfirm: async () => { await enableUser(u.id); },
			});
		} catch {
			// User cancelled the action
		}
	};

	const handleToggleUser = async (u: User) => {
		const isEnabled = u.enabled !== false;
		if (isEnabled) {
			await handleDisableUser(u);
		} else {
			await handleEnableUser(u);
		}
	};

	const fetchGroups = useCallback(async () => {
		try {
			const data = await groupService.getGroups();
			setGroups(data);
		} catch {
			if (import.meta.env.DEV) console.error("Failed to fetch groups");
		}
	}, []);

	const handleChangeGroup = (user: User) => {
		setSelectedGroupId(user.group_id || null);
		changeGroupDialog.open(user);
	};

	const handleConfirmGroupChange = async () => {
		await handleGroupChangeConfirmation({
			changeGroupDialog,
			selectedGroupId,
			setUsers,
			showSuccess,
			showError,
			fetchUsers,
			fetchGroups,
			setSelectedGroupId
		});
	};

	useEffect(() => {
		fetchUsers();
		if (isExpertOrManager(user)) {
			fetchGroups();
		}
	}, [fetchUsers, fetchGroups, user]);

	useEffect(() => {
		let active = true;
		(async () => {
			if (selectedGroup) {
				try {
					const detail = await groupService.getGroupDetail(selectedGroup.id);
					if (active) setSelectedGroupDisabled(!!detail.disabled);
				} catch {
					if (active) setSelectedGroupDisabled(null);
				}
			} else {
				setSelectedGroupDisabled(null);
			}
		})();
		return () => { active = false; };
	}, [selectedGroup]);

	const getAccessLevelIcon = (level: string) => <Shield className={`w-3 h-3 ${getAccessLevelIconColor(level)}`} />;

	const handleEditUser = (user: User) => {
		setFormData({
			name: user.name,
			email: user.email,
			organization: user.organization || "",
			position: user.position || "",
			phone: user.phone || "",
			access_level: user.access_level,
			email_verified: user.email_verified ?? false,
			model_limit: user.model_limit,
		});
		editDialog.open(user);
	};

	const handleDeleteUser = async (user: User) => {
		try {
			await confirm({
				type: "delete",
				itemType: "user",
				itemName: `${user.name} (${user.email})`,
				onConfirm: async () => { await deleteUser(user.id); },
			});
		} catch {
			// User cancelled the action
		}
	};

	const handleAddUser = () => {
		resetForm();
		addDialog.open();
	};

	// Group actions (enable/disable/delete)
	const handleDisableGroup = async () => {
		if (!selectedGroup) return;
		try {
			await confirm({
				type: "warning",
				itemType: "group",
				itemName: getGroupFullDisplayName(selectedGroup),
				description: t("userManagement.confirmations.disableGroupDescription"),
				onConfirm: async () => {
					await groupService.disableGroup(selectedGroup.id);
					setNotification({ open: true, message: t("userManagement.notifications.groupDisabled", { name: getGroupFullDisplayName(selectedGroup) }), severity: "success" });
					setSelectedGroupDisabled(true);
					await fetchUsers();
				},
			});
		} catch {
			// User cancelled the action
		}
	};

	const handleEnableGroup = async () => {
		if (!selectedGroup) return;
		try {
			await confirm({
				type: "success",
				itemType: "group",
				itemName: getGroupFullDisplayName(selectedGroup),
				description: t("userManagement.confirmations.enableGroupDescription"),
				onConfirm: async () => {
					await groupService.enableGroup(selectedGroup.id);
					setNotification({ open: true, message: t("userManagement.notifications.groupEnabled", { name: getGroupFullDisplayName(selectedGroup) }), severity: "success" });
					setSelectedGroupDisabled(false);
					await fetchUsers();
				},
			});
		} catch {
			// User cancelled the action
		}
	};

	const handleDeleteGroup = async () => {
		if (!selectedGroup) return;

		try {
			await confirm({
				type: "delete",
				itemType: "group",
				itemName: getGroupFullDisplayName(selectedGroup),
				description: t("userManagement.confirmations.deleteGroupDescription"),
				onConfirm: async () => {
					await groupService.deleteGroup(selectedGroup.id);
					setNotification({ open: true, message: t("userManagement.notifications.groupDeleted", { name: getGroupFullDisplayName(selectedGroup) }), severity: "success" });

					// Reload groups to get updated list
					await fetchGroups();

					if (isManager(user)) {
						// Fetch updated groups and select first available
						const updatedGroups = await groupService.getGroups();
						if (updatedGroups.length > 0) {
							setSelectedGroup(updatedGroups[0]);
						}
					} else {
						// Expert can view all users
						setSelectedGroup(null);
					}

					setGroupReloadKey(prev => prev + 1);
					await fetchUsers();
				},
			});
		} catch {
			// User cancelled the action
		}
	};

	const handleRenameGroup = () => {
		if (!selectedGroup) return;
		const currentName = selectedGroup.attributes?.display_name?.[0] || selectedGroup.name;
		setGroupNewName(currentName);
		renameGroupDialog.open(selectedGroup);
	};

	const handleConfirmRenameGroup = async () => {
		if (!renameGroupDialog.selectedItem || !groupNewName.trim()) return;

		try {
			await groupService.updateGroup(renameGroupDialog.selectedItem.id, { name: groupNewName.trim() });
			showSuccess(t("userManagement.notifications.groupRenamed", { name: groupNewName.trim() }));
			
			// Fetch the updated group details to get the new display_name
			const updatedGroup = await groupService.getGroupDetail(renameGroupDialog.selectedItem.id);
			setSelectedGroup(updatedGroup);
			// Optimistically update groups state so all consumers reflect the change immediately
			setGroups((prev) => prev.map(g => g.id === updatedGroup.id ? updatedGroup : g));
			// Also refresh the groups list so any other UI using it sees the new display name
			await fetchGroups();
			
			renameGroupDialog.close();
			setGroupNewName('');
			setGroupReloadKey(prev => prev + 1);
			await fetchUsers();
		} catch (error: unknown) {
			const maybeAxiosError = typeof error === "object" && error !== null
				? (error as { response?: { data?: { error?: string } } })
				: null;
			const message = maybeAxiosError?.response?.data?.error ?? t("userManagement.notifications.failedToRenameGroup");
			showError(message);
		}
	};

	const handleBulkMoveToGroup = () => {
		setBulkSelectedGroupId(null);
		bulkChangeGroupDialog.open();
	};

	const handleConfirmBulkGroupChange = async () => {
		if (!bulkSelectedGroupId || selectedUsers.length === 0) return;

		try {
			await Promise.all(
				selectedUsers.map((u) =>
					groupService.addMember(bulkSelectedGroupId, { user_id: String(u.id) })
				)
			);
			showSuccess(t("userManagement.notifications.bulkGroupChanged", { count: selectedUsers.length }));
			clearSelection();
			bulkChangeGroupDialog.close();
			setBulkSelectedGroupId(null);
			await Promise.all([fetchUsers(), fetchGroups()]);
			if (onUsersMutated) onUsersMutated();
		} catch {
			showError(t("userManagement.notifications.bulkGroupChangeFailed"));
		}
	};

	const handleBulkDelete = async () => {
		if (selectedUsers.length === 0) return;

		try {
			await confirm({
				type: "delete",
				itemType: "user",
				itemName: t("userManagement.actions.selected", { count: selectedUsers.length }),
				description: t("userManagement.confirmations.bulkDeleteDescription", { count: selectedUsers.length }),
				onConfirm: async () => {
					const results = await Promise.allSettled(
						selectedUsers.map((u) => axios.delete(`/users/${u.id}`))
					);
					const succeeded = results.filter((r) => r.status === "fulfilled").length;
					const failed = results.length - succeeded;

					if (failed === 0) {
						showSuccess(t("userManagement.notifications.bulkDeleted", { count: succeeded }));
					} else {
						setNotification({
							open: true,
							message: t("userManagement.notifications.bulkDeletePartial", {
								succeeded: String(succeeded),
								total: String(results.length),
								failed: String(failed),
							}),
							severity: "warning",
						});
					}

					clearSelection();
					await fetchUsers();
					if (onUsersMutated) onUsersMutated();
				},
			});
		} catch {
			// User cancelled the action
		}
	};

	const handleSaveUser = async () => {
		setFormLoading(true);
		setFormErrors({});

		try {
			const isEdit = !!editDialog.selectedItem;
			const errors = validateUserForm(formData as unknown as Record<string, unknown>, isEdit, t);

			if (Object.keys(errors).length > 0) {
				setFormErrors(errors);
				return;
			}

			let success = false;

			if (editDialog.selectedItem) {
				success = await updateUser(editDialog.selectedItem.id, formData);
			} else {
				if (!formData.password || formData.password !== formData.password_confirmation) {
					setFormErrors({ password_confirmation: t("userManagement.notifications.passwordMismatch") });
					return;
				}
				success = await createUser(formData);
			}

			if (success) {
				editDialog.close();
				addDialog.close();
				resetForm();
			}
		} catch {
			if (import.meta.env.DEV) console.error("Error saving user");
		} finally {
			setFormLoading(false);
		}
	};

	const resetForm = () => {
		setFormData({
			name: "",
			email: "",
			organization: "",
			position: "",
			phone: "",
			access_level: "very_low",
			email_verified: false,
			password: "",
			password_confirmation: "",
			model_limit: undefined,
		});
		setFormErrors({});
	};

	// Default model limits per access level
	const defaultModelLimits: Record<string, number> = {
		very_low: 10,
		intermediate: 25,
		manager: 50,
		expert: 0,
	};

	const handleFormChange = (key: string, value: FormDataConvertible) => {
		setFormData((prev) => {
			const updated = { ...prev, [key]: value };
			
			// Auto-update model_limit when access_level changes
			if (key === "access_level" && typeof value === "string") {
				updated.model_limit = defaultModelLimits[value] ?? 10;
			}
			
			return updated;
		});

		// Clear error for this field
		if (formErrors[key]) {
			setFormErrors((prev) => {
				const newErrors = { ...prev };
				delete newErrors[key];
				return newErrors;
			});
		}
	};

	const noResults = !loading && users.length === 0 && !!debouncedSearch;

	return (
		<div className="space-y-6 overflow-visible">

			<div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4">
				<div className="flex items-center gap-3">
					<div className="p-2 bg-muted rounded-lg">
						<Users className="w-5 h-5 text-muted-foreground" />
					</div>
					<div>
						<h2 className="text-lg font-semibold text-foreground">{t("userManagement.title")}</h2>
						<p className="text-xs text-muted-foreground">{t("userManagement.subtitle")}</p>
					</div>
				</div>
				<div className="flex flex-wrap items-center gap-3">
					<div className="relative">
						<input
							type="text"
							value={searchTerm}
							onChange={(e) => setSearchTerm(e.target.value)}
							placeholder={t("userManagement.searchPlaceholder")}
							className="pl-9 pr-8 py-2.5 border border-input rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent w-full sm:w-72 bg-background text-foreground"
							aria-label="Search users"
						/>
						<span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
							<svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
								<path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-4.35-4.35m0 0A7.5 7.5 0 1010.5 18a7.5 7.5 0 006.15-3.35z" />
							</svg>
						</span>
						{searchTerm && (
							<button
								onClick={() => setSearchTerm("")}
								className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
								aria-label="Clear search"
							>
								×
							</button>
						)}
					</div>
				<Tooltip>
					<TooltipTrigger asChild>
						<button
							onClick={() => {
								setIsRefreshing(true);
								fetchUsers();
								fetchGroups();
								setTimeout(() => setIsRefreshing(false), 1000);
							}}
							disabled={loading}
							className="p-2.5 bg-muted text-muted-foreground rounded-lg hover:bg-muted/80 transition-colors duration-200 disabled:opacity-50"
						>
							<RefreshCw className={`w-4 h-4 transition-transform duration-500 ${loading || isRefreshing ? "animate-spin" : ""}`} />
						</button>
					</TooltipTrigger>
					<TooltipContent>{t("userManagement.refresh")}</TooltipContent>
				</Tooltip>
					{isExpertOrManager(user) && (
						<Tooltip>
							<TooltipTrigger asChild>
								<div>
									<GroupSelector
										onGroupChange={setSelectedGroup}
										onCreateGroup={groupManagementDialog.open}
										reloadKey={groupReloadKey}
										activeGroup={selectedGroup}
										accessLevel={user?.access_level}
									/>
								</div>
							</TooltipTrigger>
							<TooltipContent>{t("userManagement.groups.selectOrCreate")}</TooltipContent>
						</Tooltip>
					)}
					{/* Group actions when a group is selected - single toggle icon (hidden for Default) */}
					{selectedGroup && isExpertOrManager(user) && (
						<div className="flex items-center gap-2">
							{selectedGroup.name?.toLowerCase() !== 'default' && (
								<>
									<Tooltip>
										<TooltipTrigger asChild>
											<button
												onClick={handleRenameGroup}
												className="p-2 border border-border rounded-lg text-sm hover:bg-muted transition-colors"
												aria-label="Rename group"
											>
												<Edit className="w-4 h-4 text-muted-foreground" />
											</button>
										</TooltipTrigger>
										<TooltipContent>{t("userManagement.groups.renameGroup")}</TooltipContent>
									</Tooltip>
									<Tooltip>
										<TooltipTrigger asChild>
											<button
												onClick={() => (selectedGroupDisabled ? handleEnableGroup() : handleDisableGroup())}
												className="p-2 border border-border rounded-lg text-sm hover:bg-muted transition-colors"
												aria-label={selectedGroupDisabled ? "Enable group" : "Disable group"}
											>
												{selectedGroupDisabled ? (
													<Check className="w-4 h-4 text-green-600" />
												) : (
													<XCircle className="w-4 h-4 text-muted-foreground" />
												)}
											</button>
										</TooltipTrigger>
										<TooltipContent>{selectedGroupDisabled ? t("userManagement.groups.enableGroup") : t("userManagement.groups.disableGroup")}</TooltipContent>
									</Tooltip>
								</>
							)}
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										onClick={handleDeleteGroup}
										className="p-2 border border-red-200 dark:border-red-800 text-red-600 dark:text-red-400 rounded-lg text-sm hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
										aria-label="Delete group"
										disabled={selectedGroup.name?.toLowerCase() === 'default'}
									>
										<Trash2 className="w-4 h-4" />
									</button>
								</TooltipTrigger>
								<TooltipContent>{selectedGroup.name?.toLowerCase() === 'default' ? t("userManagement.groups.defaultCannotDelete") : t("userManagement.groups.deleteGroup")}</TooltipContent>
							</Tooltip>
						</div>
					)}
				{selectedUsers.length > 0 && isExpertOrManager(user) && (
						<div className="flex items-center gap-2 ml-2 pl-2 border-l-2 border-foreground/30">
							<span className="text-xs font-medium text-muted-foreground">
								{t("userManagement.actions.selected", { count: selectedUsers.length })}
							</span>
							<div className="flex items-center gap-1 px-2 py-1 border border-border rounded-md bg-muted/50">
								<Tooltip>
									<TooltipTrigger asChild>
										<button
											onClick={handleBulkMoveToGroup}
											className="inline-flex items-center justify-center h-7 w-7 rounded hover:bg-muted transition-colors cursor-pointer"
										>
											<FolderInput className="w-4 h-4" />
										</button>
									</TooltipTrigger>
									<TooltipContent>{t("userManagement.actions.bulkMoveToGroup")}</TooltipContent>
								</Tooltip>
								<Tooltip>
									<TooltipTrigger asChild>
										<button
											onClick={() => { void handleBulkDelete(); }}
											className="inline-flex items-center justify-center h-7 w-7 rounded text-destructive hover:text-destructive hover:bg-destructive/10 transition-colors cursor-pointer"
										>
											<Trash2 className="w-4 h-4" />
										</button>
									</TooltipTrigger>
									<TooltipContent>{t("userManagement.actions.bulkDelete")}</TooltipContent>
								</Tooltip>
							</div>
						</div>
					)}
				<button
					onClick={handleAddUser}
					className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground text-sm font-medium rounded-lg hover:bg-primary/90 transition-all shadow-sm hover:shadow-md"
				>
					<UserPlus className="w-4 h-4" />
					<span className="hidden sm:inline">{t("userManagement.addNewUser")}</span>
					<span className="sm:hidden">{t("userManagement.add")}</span>
				</button>
			</div>
		</div>
		<div className="bg-card rounded-xl border border-border overflow-visible shadow-sm">
			<div className="overflow-x-auto overflow-y-visible">
				<table className="min-w-full divide-y divide-border">
						<thead className="bg-muted/50">
							<tr>
								{isExpertOrManager(user) && (
									<th className="px-3 py-2 w-10">
										<Tooltip>
											<TooltipTrigger asChild>
												<input
													type="checkbox"
													checked={selectedUsers.length === users.length && users.length > 0}
													onChange={() => handleSelectAll(users)}
													className="w-4 h-4 text-foreground rounded border-input focus:ring-ring focus:ring-offset-0 cursor-pointer"
												/>
											</TooltipTrigger>
											<TooltipContent>
												{selectedUsers.length > 0 ? t("userManagement.actions.deselectAll") : t("userManagement.actions.selectAll")}
											</TooltipContent>
										</Tooltip>
									</th>
								)}
								<th className="px-3 py-2 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t("userManagement.table.user")}</th>
								<th className="px-3 py-2 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t("userManagement.table.organization")}</th>
								<th className="px-3 py-2 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t("userManagement.table.position")}</th>
								<th className="px-3 py-2 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t("userManagement.table.accessLevel")}</th>
								<th className="px-3 py-2 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t("userManagement.table.group")}</th>
								<th className="px-3 py-2 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t("userManagement.table.emailVerified")}</th>
								<th className="px-3 py-2 text-left text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t("userManagement.table.phone")}</th>
								<th className="px-3 py-2 text-right text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{t("userManagement.table.actions")}</th>
							</tr>
						</thead>
						<tbody className="divide-y divide-border">
							{loading ? (
								<tr>
									<td colSpan={isExpertOrManager(user) ? 9 : 8} className="px-6 py-16 text-center">
										<div className="flex flex-col items-center justify-center gap-3">
											<div className="relative">
												<div className="w-10 h-10 rounded-full border-4 border-muted"></div>
												<div className="absolute top-0 left-0 w-10 h-10 rounded-full border-4 border-indigo-500 border-t-transparent animate-spin"></div>
											</div>
											<span className="text-sm text-muted-foreground">{t("userManagement.loadingUsers")}</span>
										</div>
									</td>
								</tr>
							) : (
								<>
									{users.length === 0 ? (
										<tr>
											<td colSpan={isExpertOrManager(user) ? 9 : 8} className="px-6 py-16 text-center">
												<div className="flex flex-col items-center justify-center gap-3">
													<div className="w-16 h-16 bg-muted rounded-2xl flex items-center justify-center">
														<Users className="w-8 h-8 text-muted-foreground" />
													</div>
													<div>
														<p className="text-lg font-medium text-foreground mb-1">{t("userManagement.noUsersFound")}</p>
														<p className="text-sm text-muted-foreground">
															{getUsersEmptyMessage(t, user, noResults, debouncedSearch)}
														</p>
													</div>
												</div>
											</td>
										</tr>
									) : (
										users.map((tableUser) => (
									<tr key={tableUser.id} className={`hover:bg-muted/50 transition-colors duration-150 ${isExpertOrManager(user) && isSelected(tableUser) ? "bg-muted" : ""}`}>
										{isExpertOrManager(user) && (
											<td className="px-3 py-2 w-10">
												<input
													type="checkbox"
													checked={isSelected(tableUser)}
													onChange={() => handleSelectUser(tableUser)}
													className="w-4 h-4 text-foreground rounded border-input focus:ring-ring focus:ring-offset-0 cursor-pointer"
												/>
											</td>
										)}
										<td className="px-3 py-2">
											<div className="flex items-center gap-2.5">
												<Tooltip>
													<TooltipTrigger asChild>
														<div className="w-8 h-8 bg-muted rounded-lg flex items-center justify-center text-foreground text-xs font-medium cursor-default">
															{tableUser.name.charAt(0).toUpperCase()}
														</div>
													</TooltipTrigger>
													<TooltipContent side="top">
														{tableUser.created_at
															? `Created: ${new Date(tableUser.created_at).toLocaleString()}`
															: "Creation date unknown"}
													</TooltipContent>
												</Tooltip>
												<div className="min-w-0">
													<div className="text-sm font-medium text-foreground">{tableUser.name}</div>
													<div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
														<Mail className="w-2.5 h-2.5" />
														<span className="truncate">{tableUser.email}</span>
														<Tooltip>
															<TooltipTrigger asChild>
																<button
																	onClick={() => handleCopyEmail(tableUser.email)}
																	className="inline-flex items-center justify-center p-0.5 rounded hover:bg-muted transition-colors duration-150 cursor-pointer"
																>
																	{copiedEmail === tableUser.email ? (
																		<Check className="w-2.5 h-2.5 text-green-600" />
																	) : (
																		<Copy className="w-2.5 h-2.5 text-muted-foreground hover:text-foreground dark:text-white" />
																	)}
																</button>
															</TooltipTrigger>
															<TooltipContent side="top">
																{copiedEmail === tableUser.email ? t("userManagement.actions.copied") : t("userManagement.actions.copyEmail")}
															</TooltipContent>
														</Tooltip>
													</div>
												</div>
											</div>
										</td>
										<td className="px-3 py-2">
											<TableIconCell
												icon={<Building className="w-3 h-3 text-muted-foreground" />}
												text={tableUser.organization}
											/>
										</td>
										<td className="px-3 py-2">
											<TableIconCell
												icon={<Briefcase className="w-3 h-3 text-muted-foreground" />}
												text={tableUser.position}
											/>
										</td>
										<td className="px-3 py-2">
											<StatusBadge
												icon={getAccessLevelIcon(tableUser.access_level)}
												text={getAccessLevelName(tableUser.access_level)}
												variant="default"
												size="small"
												className={getAccessLevelColor(tableUser.access_level)}
											/>
										</td>
										<td className="px-3 py-2">
											<Tooltip>
												<TooltipTrigger asChild>
													<div className="inline-block">
														<StatusBadge
															icon={<Users className="w-3 h-3" />}
															text={tableUser.group_id ? (() => {
																const group = groups.find(g => g.id === tableUser.group_id);
																if (!group) return t("userManagement.groups.unknown");
																return getGroupDisplayName(group);
															})() : t("userManagement.groups.default")}
															variant="info"
															size="small"
														/>
													</div>
												</TooltipTrigger>
												<TooltipContent>
													{tableUser.group_id ? (() => {
														const group = groups.find(g => g.id === tableUser.group_id);
														if (!group) return t("userManagement.groups.unknownGroup");
														return getGroupFullDisplayName(group);
													})() : t("userManagement.groups.defaultGroup")}
												</TooltipContent>
											</Tooltip>
										</td>
										<td className="px-3 py-2">
											<StatusBadge
												icon={tableUser.email_verified ? <CheckCircle className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
												text={tableUser.email_verified ? t("userManagement.emailStatus.verified") : t("userManagement.emailStatus.unverified")}
												variant={tableUser.email_verified ? "success" : "default"}
												size="small"
											/>
										</td>
										<td className="px-3 py-2">
											<TableIconCell
												icon={<Phone className="w-3 h-3 text-muted-foreground" />}
												text={tableUser.phone}
											/>
										</td>
										<td className="px-3 py-2 text-right">
											<ModelActionGroup
												actions={[
													// Experts and managers can change user groups
													...(isExpertOrManager(user) ? [{
														key: "group",
														icon: UserCog,
														tooltip: t("userManagement.actions.changeGroup"),
														variant: "default" as const,
														onClick: () => handleChangeGroup(tableUser),
													}] : []),
													// Single toggle enable/disable icon
													...(isExpertOrManager(user) ? [{
														key: "toggle-enabled",
														icon: (tableUser.enabled === false) ? UserX : UserCheck,
														tooltip: (tableUser.enabled === false) ? t("userManagement.actions.enableUser") : t("userManagement.actions.disableUser"),
														variant: "default" as const,
														onClick: () => handleToggleUser(tableUser),
													}] : []),
													{
														key: "edit",
														icon: Edit,
														tooltip: t("userManagement.actions.editUser"),
														variant: "default" as const,
														onClick: () => handleEditUser(tableUser),
													},
													{
														key: "delete",
														icon: Trash2,
														tooltip: t("userManagement.actions.deleteUser"),
														variant: "danger" as const,
														onClick: () => { void handleDeleteUser(tableUser); },
													},
												]}
												layout="horizontal"
												size="small"
											/>
										</td>
									</tr>
								))
								)}
								</>
							)}
						</tbody>
					</table>
				</div>


				<Pagination
					currentPage={page}
					totalItems={totalCount}
					itemsPerPage={rowsPerPage}
					onPageChange={setPage}
					onItemsPerPageChange={(newItemsPerPage: number) => {
						setRowsPerPage(newItemsPerPage);
						setPage(0);
					}}
					isLoading={loading}
			/>
		</div>

		<UniversalForm
			isOpen={editDialog.isOpen || addDialog.isOpen}
			onClose={() => {
				editDialog.close();
				addDialog.close();
				resetForm();
			}}
			title={editDialog.selectedItem ? t("userManagement.dialog.editTitle") : t("userManagement.dialog.addTitle")}
			sections={getUserFormSections(!!editDialog.selectedItem, t, user?.access_level)}
			values={formData as unknown as Record<string, FormDataConvertible>}
			onChange={handleFormChange}
			onSubmit={handleSaveUser}
			submitText={editDialog.selectedItem ? t("userManagement.dialog.updateUser") : t("userManagement.dialog.createUser")}
			loading={formLoading}
			errors={formErrors}
			maxWidth="lg"
		/>
		{isExpertOrManager(user) && (
			<GroupManagement
				isOpen={groupManagementDialog.isOpen}
				onClose={groupManagementDialog.close}
				onSuccess={() => {
					fetchGroups();
					fetchUsers();
					setGroupReloadKey(prev => prev + 1);
				}}
				onNotification={(message, severity) => setNotification({ open: true, message, severity })}
			/>
		)}


		<UniversalForm
			isOpen={changeGroupDialog.isOpen}
			onClose={() => {
				changeGroupDialog.close();
				setSelectedGroupId(null);
			}}
			title={t("userManagement.groups.changeUserGroup")}
			sections={[
				{
					title: t("userManagement.groups.groupAssignment"),
					fields: [
						{
							key: "user",
							label: t("userManagement.table.user"),
							type: "text",
							value: changeGroupDialog.selectedItem?.name || "",
							disabled: true,
						},
						{
							key: "group_id",
							label: t("userManagement.groups.selectGroup"),
							type: "select",
							required: true,
							options: groups.map(g => ({
								value: g.id,
								label: getGroupFullDisplayName(g)
							})),
						},
					],
			},
		]}
		values={{ user: changeGroupDialog.selectedItem?.name || "", group_id: selectedGroupId || "" }}
		onChange={(key, value) => {
			if (key === "group_id") {
				setSelectedGroupId(value as string);
			}
		}}
		onSubmit={handleConfirmGroupChange}
		submitText={t("userManagement.groups.changeGroup")}
		loading={false}
		errors={{}}
		maxWidth="sm"
	/>

	<UniversalForm
		isOpen={bulkChangeGroupDialog.isOpen}
		onClose={() => {
			bulkChangeGroupDialog.close();
			setBulkSelectedGroupId(null);
		}}
		title={t("userManagement.groups.bulkChangeGroup")}
		sections={[
			{
				title: t("userManagement.groups.groupAssignment"),
				fields: [
					{
						key: "users",
						label: t("userManagement.table.user"),
						type: "text",
						value: t("userManagement.actions.selected", { count: selectedUsers.length }),
						disabled: true,
					},
					{
						key: "group_id",
						label: t("userManagement.groups.selectGroup"),
						type: "select",
						required: true,
						options: groups.map(g => ({
							value: g.id,
							label: getGroupFullDisplayName(g)
						})),
					},
				],
			},
		]}
		values={{ users: t("userManagement.actions.selected", { count: selectedUsers.length }), group_id: bulkSelectedGroupId || "" }}
		onChange={(key, value) => {
			if (key === "group_id") {
				setBulkSelectedGroupId(value as string);
			}
		}}
		onSubmit={handleConfirmBulkGroupChange}
		submitText={t("userManagement.groups.moveUsers")}
		loading={false}
		errors={{}}
		maxWidth="sm"
	/>

	<UniversalForm
		isOpen={renameGroupDialog.isOpen}
		onClose={() => {
			renameGroupDialog.close();
			setGroupNewName('');
		}}
		title={t("userManagement.groups.renameGroupTitle")}
		sections={[
			{
				title: t("userManagement.groups.groupName"),
				fields: [
					{
						key: "name",
						label: t("userManagement.groups.newGroupName"),
						type: "text",
						required: true,
						placeholder: t("userManagement.groups.enterNewGroupName"),
					},
				],
			},
		]}
		values={{ name: groupNewName }}
		onChange={(key, value) => {
			if (key === "name") {
				setGroupNewName(value as string);
			}
		}}
		onSubmit={handleConfirmRenameGroup}
		submitText={t("userManagement.groups.rename")}
		loading={false}
		errors={{}}
		maxWidth="sm"
	/>

	<Notification
		isOpen={notification.open}
		message={notification.message}
		severity={notification.severity}
		onClose={hideNotification}
	/>
</div>
);
};

// Helper function for fetching users with pagination
async function fetchUsersWithPagination(params: {
	user: User | null;
	selectedGroup: Group | null;
	debouncedSearch: string;
	page: number;
	rowsPerPage: number;
	setUsers: (users: User[]) => void;
	setTotalCount: (count: number) => void;
	setLoading: (loading: boolean) => void;
	setNotification: (notification: Notification) => void;
	navigate: NavigateFunction;
}) {
	const { user, selectedGroup, debouncedSearch, page, rowsPerPage, setUsers, setTotalCount, setLoading, setNotification, navigate } = params;

	if (!user) {
		setNotification({ open: true, message: "Please log in to view users", severity: "error" });
		navigate("/login");
		return;
	}

	if (isManager(user) && !selectedGroup) {
		setUsers([]);
		setTotalCount(0);
		setLoading(false);
		return;
	}

	setLoading(true);
	try {
		const searchParam = debouncedSearch ? `&search=${encodeURIComponent(debouncedSearch)}` : "";

		const paginationParams = getPaginationParams({
			page,
			rowsPerPage,
			accessLevel: user.access_level,
			selectedGroup
		});
		const perPageParam = paginationParams.perPage;
		const pageParam = paginationParams.pageNumber;

		const response = await axios.get(`/users?page=${pageParam}&per_page=${perPageParam}${searchParam}`);
		const data: ApiResponse<{ data: User[]; total: number }> = response.data;

		if (data.success) {
			const list = data.data?.data || [];
			const backendTotal = data.data?.total || 0;

			if (paginationParams.shouldFilterClient) {
				const filtered = filterByGroup(list, selectedGroup);
				const paginated = paginateArray(filtered, page, rowsPerPage);
				setUsers(paginated.items);
				setTotalCount(paginated.total);
			} else {
				setUsers(list);
				setTotalCount(backendTotal);
			}
		} else {
			throw new Error(data.message || "Failed to fetch users");
		}
	} catch {
		if (import.meta.env.DEV) console.error("Error fetching users");
		setNotification({ open: true, message: "Failed to fetch users", severity: "error" });
	} finally {
		setLoading(false);
	}
}

// Helper function for handling group change confirmation
async function handleGroupChangeConfirmation(params: {
	changeGroupDialog: UserDialogState;
	selectedGroupId: string | null;
	setUsers: React.Dispatch<React.SetStateAction<User[]>>;
	showSuccess: (message: string) => void;
	showError: (message: string) => void;
	fetchUsers: () => Promise<void>;
	fetchGroups: () => Promise<void>;
	setSelectedGroupId: (id: string | null) => void;
}) {
	const { changeGroupDialog, selectedGroupId, setUsers, showSuccess, showError, fetchUsers, fetchGroups, setSelectedGroupId } = params;

	if (!changeGroupDialog.selectedItem || selectedGroupId === null) return;

	const movedUserId = changeGroupDialog.selectedItem.id;

	try {
		await groupService.addMember(selectedGroupId, { user_id: String(movedUserId) });

		// Optimistically update the user in the local state
		setUsers(prevUsers =>
			prevUsers.map(u =>
				u.id === movedUserId
					? { ...u, group_id: selectedGroupId }
					: u
			)
		);

		showSuccess("User moved to new group and logged out. They must re-login to access their new workspace.");
		changeGroupDialog.close();
		setSelectedGroupId(null);

		// Refresh in background without blocking UI
		Promise.all([fetchUsers(), fetchGroups()])
			.catch(err => {
				if (import.meta.env.DEV) console.error("Failed to refresh after group change:", err);
			});
	} catch (error: unknown) {
		if (import.meta.env.DEV) console.error("Failed to update user group:", error);
		const maybeAxiosError = typeof error === "object" && error !== null
			? (error as { response?: { data?: { error?: string; message?: string } } })
			: null;
		const errorMsg = maybeAxiosError?.response?.data?.error
			|| maybeAxiosError?.response?.data?.message
			|| "Failed to update user group";
		showError(errorMsg);
	}
}
