import React, { useState, lazy, Suspense } from "react";
import {
	User,
	Building,
	Briefcase,
	Phone,
	Mail,
	Shield,
	LogOut,
	Settings,
	AlertTriangle,
	Users,
	UserCog,
	Brain,
	Layers,
	MapPin,
	Zap,
	LayoutDashboard,
	ChevronRight,
	Sparkles,
	CheckCircle,
} from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useAuthStore } from "@/store/auth-store";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/providers/auth-provider";
import { Authorized } from "@/middleware/authorized";
import { Tooltip, TooltipTrigger, TooltipContent } from "@spatialhub/ui";
import { closeNotificationStream } from "@/features/notifications/hooks/useNotificationsQuery";
import { useAdminUsersCount } from "./hooks/useAdminUsersCount";
import { useAdminModelActions } from "./hooks/useAdminModelActions";
import {
	buildStatsCards,
	dashboardTabIcons,
	getAccessLevelColor,
	getAccessLevelName,
	getAccessProgress,
	getAvailableLayers,
	getDashboardTabs,
} from "./utils/dashboardHelpers";

// Lazy load management components for better performance
const WebservicesManagement = lazy(() => import("./WebservicesManagement"));
const PylovoManagement = lazy(() => import("./PylovoManagement"));
const UserManagement = lazy(() => import("./UserManagement").then(m => ({ default: m.UserManagement })));
const ModelsManagement = lazy(() => import("./ModelsManagement").then(m => ({ default: m.ModelsManagement })));
const FeedbackManagement = lazy(() => import("./FeedbackManagement").then(m => ({ default: m.FeedbackManagement })));

interface TabPanelProps {
	readonly children?: React.ReactNode;
	readonly index: number;
	readonly value: number;
}

function TabPanel({ children, value, index }: Readonly<TabPanelProps>) {
	// Only render children when tab is active - prevents unnecessary component mounting
	if (value !== index) return null;

	return (
		<div role="tabpanel" id={`simple-tabpanel-${index}`} aria-labelledby={`simple-tab-${index}`}>
			<div className="p-3 md:p-4">{children}</div>
		</div>
	);
}

// Loading fallback component for lazy-loaded tabs
const TabLoadingFallback = () => {
	const { t } = useTranslation();
	return (
	<div className="flex items-center justify-center py-16">
		<div className="flex flex-col items-center gap-4">
			<div className="relative">
				<div className="w-12 h-12 rounded-full border-4 border-gray-200"></div>
				<div className="absolute top-0 left-0 w-12 h-12 rounded-full border-4 border-gray-600 border-t-transparent animate-spin"></div>
			</div>
			<span className="text-sm text-gray-500 dark:text-gray-400 font-medium">{t('adminDashboard.loadingContent')}</span>
		</div>
	</div>
);
};

export const Dashboard: React.FC = () => {
	const { t } = useTranslation();
	useDocumentTitle(t('adminDashboard.title'));
	
	const { logout } = useAuthStore();
	const { user } = useAuth();
	const navigate = useNavigate();

	// State management
	const [tabValue, setTabValue] = useState(0);
	const isExpert = user?.access_level === "expert";
	const isManager = user?.access_level === "manager";
	const canManageUsers = isExpert || isManager;
	const isAdmin = canManageUsers;
	const { usersCount, usersCountLoading, onlineCount, refreshUsersCount } = useAdminUsersCount(canManageUsers);

	// Event handlers for user interactions and navigation
	const handleLogout = () => {
		closeNotificationStream();
		logout();
		navigate("/login");
	};

	const handleTabChange = (newValue: number) => {
		setTabValue(newValue);
	};

	// Component action handlers for child component events
	const handleModelAction = useAdminModelActions();

	const handleWebserviceAction = () => {};

	const handleFeedbackAction = () => {};

	const statsCards = buildStatsCards(user, canManageUsers, usersCount, usersCountLoading, t, onlineCount);

	// Tab navigation configuration
	const allTabs = getDashboardTabs(t, canManageUsers, isExpert);
	const tabs = allTabs.filter((tab) => tab.show);
	
	// Create tab index mapping for TabPanels
	const getTabIndex = (key: string) => {
		return tabs.findIndex(tab => tab.key === key);
	};

	return (
		<div className="min-h-screen bg-background">
			<div className="p-3 md:p-4 lg:p-5 max-w-[1600px] mx-auto space-y-4">
				{/* Main header section with welcome message and user info */}
				<div className="relative overflow-hidden rounded-xl bg-gradient-to-br from-gray-800 via-gray-900 to-black p-4 md:p-5 text-white shadow-xl">
					{/* Decorative elements */}
					<div className="absolute top-0 right-0 w-64 h-64 bg-gradient-to-br from-white/10 to-transparent rounded-full -translate-y-1/2 translate-x-1/2"></div>
					<div className="absolute bottom-0 left-0 w-48 h-48 bg-gradient-to-tr from-white/5 to-transparent rounded-full translate-y-1/2 -translate-x-1/2"></div>
					<div className="absolute top-1/2 left-1/2 w-96 h-96 bg-gradient-radial from-white/5 to-transparent rounded-full -translate-x-1/2 -translate-y-1/2 opacity-50"></div>

					<div className="relative flex flex-col md:flex-row justify-between items-start md:items-center gap-4">
						<div className="space-y-2">
							<div className="flex items-center gap-2 text-gray-400 dark:text-gray-300 text-sm">
								<Sparkles className="w-4 h-4" />
								<span>{t('adminDashboard.title')}</span>
							</div>
							<h1 className="text-xl md:text-2xl lg:text-2xl font-bold tracking-tight">
								{t('adminDashboard.welcomeBack', { name: user?.name })}
							</h1>
							<div className="flex flex-wrap items-center gap-3">
								<p className="text-gray-300 text-sm md:text-base">{t('adminDashboard.managePlatform')}</p>
								{isAdmin && (
									<span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/10 backdrop-blur-sm text-xs font-medium border border-white/20">
										<UserCog className="w-3.5 h-3.5" />
										{t('adminDashboard.administrator')}
									</span>
								)}
							</div>
						</div>
						<div className="flex items-center gap-2">
							<Tooltip>
								<TooltipTrigger asChild>
									<button 
										onClick={() => navigate("/app/profile", { state: { from: 'admin' } })} 
										className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 backdrop-blur-sm border border-white/10 transition-all duration-200 hover:scale-105"
									>
										<User className="w-5 h-5" />
									</button>
								</TooltipTrigger>
								<TooltipContent side="bottom">{t('adminDashboard.profile')}</TooltipContent>
							</Tooltip>
							<Tooltip>
								<TooltipTrigger asChild>
									<button 
										onClick={() => navigate("/app/settings", { state: { from: 'admin' } })} 
										className="p-2.5 rounded-xl bg-white/10 hover:bg-white/20 backdrop-blur-sm border border-white/10 transition-all duration-200 hover:scale-105"
									>
										<Settings className="w-5 h-5" />
									</button>
								</TooltipTrigger>
								<TooltipContent side="bottom">{t('adminDashboard.settings')}</TooltipContent>
							</Tooltip>
							<Tooltip>
								<TooltipTrigger asChild>
									<button
										onClick={handleLogout}
										className="flex items-center gap-2 px-4 py-2.5 rounded-xl bg-white/10 hover:bg-red-500/80 backdrop-blur-sm border border-white/10 hover:border-red-400/50 transition-all duration-200 text-sm font-medium"
									>
										<LogOut className="w-4 h-4" />
										<span className="hidden sm:inline">{t('adminDashboard.logout')}</span>
									</button>
								</TooltipTrigger>
								<TooltipContent side="bottom">{t('adminDashboard.logout')}</TooltipContent>
							</Tooltip>
						</div>
					</div>
				</div>

					{/* User statistics cards section */}
				<div className="grid grid-cols-2 md:grid-cols-4 gap-3">
					{statsCards.map((stat) => (
						<div
							key={stat.title}
							className="group relative bg-card rounded-lg p-2.5 shadow-sm border border-border hover:shadow-md hover:border-ring transition-all duration-200 overflow-hidden"
						>
							<div className="relative flex items-center gap-2.5">
								<div className="p-1.5 rounded-md bg-muted flex-shrink-0">
									{stat.icon}
								</div>
								<div className="flex-1 min-w-0">
									<p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold truncate">{stat.title}</p>
									<div className="flex items-center gap-2">
										<p className="text-base font-bold text-foreground truncate">{stat.value}</p>
										{stat._loading && (
											<div className="w-2.5 h-2.5 border-2 border-muted-foreground border-t-transparent rounded-full animate-spin flex-shrink-0"></div>
										)}
									</div>
									<span className="text-[10px] text-muted-foreground">{stat.trend}</span>
								</div>
							</div>
						</div>
					))}
				</div>

				{/* Main content area with tabbed interface */}
				<div className="bg-card rounded-2xl shadow-sm border border-border overflow-hidden">
					{/* Tab navigation */}
					<div className="border-b border-border bg-muted/50">
						<nav className="flex overflow-x-auto scrollbar-hide px-2 md:px-4 py-2 gap-1">
							{tabs.map((tab, index) => (
								<button
									key={tab.label}
									onClick={() => handleTabChange(index)}
									className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm whitespace-nowrap transition-all duration-200 ${
										tabValue === index
											? "bg-primary text-primary-foreground shadow-sm"
											: "text-muted-foreground hover:text-foreground hover:bg-muted"
									}`}
								>
									{dashboardTabIcons[tab.key]}
									<span className="hidden sm:inline">{tab.label}</span>
								</button>
							))}
						</nav>
					</div>

					{/* Overview tab content with user profile and permissions */}
					<TabPanel value={tabValue} index={getTabIndex("overview")}>
						<div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
							{/* User profile information card */}
							<div className="bg-gradient-to-br from-muted/50 to-card rounded-xl p-4 border border-border shadow-sm">
								<div className="flex items-center gap-3 mb-4">
									<div className="p-2 bg-muted rounded-lg">
										<User className="w-4 h-4 text-muted-foreground" />
									</div>
									<div>
										<h3 className="text-base font-semibold text-foreground">{t('adminDashboard.userProfile.title')}</h3>
										<p className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('adminDashboard.userProfile.subtitle')}</p>
									</div>
								</div>

								<div className="space-y-4">
									<div className="flex flex-col items-center text-center pb-4 border-b border-border">
										<div className="relative mb-3">
											<div className="w-16 h-16 bg-gradient-to-br from-gray-600 to-gray-800 rounded-xl flex items-center justify-center text-white text-xl font-bold shadow-lg">
												{user?.name?.charAt(0).toUpperCase()}
											</div>
											<div className="absolute -bottom-1 -right-1 w-5 h-5 bg-green-500 rounded-full border-4 border-card"></div>
										</div>
										<h4 className="text-lg font-semibold text-foreground mb-1">{user?.name}</h4>
										<span className={`inline-flex items-center px-2.5 py-1 rounded-full text-[10px] font-semibold ${getAccessLevelColor(user?.access_level || "")}`}>
											{getAccessLevelName(user?.access_level || "", t)}
										</span>
									</div>

									<div className="space-y-2">
										{[
											{ icon: Mail, label: t('adminDashboard.userProfile.email'), value: user?.email },
											{ icon: Building, label: t('adminDashboard.userProfile.organization'), value: user?.organization },
											{ icon: Briefcase, label: t('adminDashboard.userProfile.position'), value: user?.position },
											{ icon: Phone, label: t('adminDashboard.userProfile.phone'), value: user?.phone },
										].filter(item => item.value).map((item) => (
											<div key={item.label} className="flex items-center gap-3 p-2.5 rounded-lg bg-muted hover:bg-muted/80 transition-colors">
												<item.icon className="w-3.5 h-3.5 text-muted-foreground" />
												<div className="flex-1 min-w-0">
													<p className="text-[10px] text-muted-foreground uppercase tracking-wider">{item.label}</p>
													<p className="text-sm font-medium text-foreground truncate">{item.value}</p>
												</div>
											</div>
										))}
									</div>
								</div>
							</div>

							{/* User access permissions and capabilities card */}
							<div className="bg-card rounded-xl p-4 border border-border/60 shadow-sm h-full flex flex-col relative overflow-hidden group hover:shadow-md transition-all duration-300">
								{/* Decorative background gradient */}
								<div className="absolute top-0 right-0 w-32 h-32 bg-gradient-to-br from-primary/5 to-transparent rounded-bl-full -mr-8 -mt-8 transition-transform group-hover:scale-110 duration-700 pointer-events-none"></div>

								<div className="flex items-center justify-between mb-6 relative">
									<div className="flex items-center gap-3">
										<div className="p-2 bg-primary/10 rounded-lg">
											<Shield className="w-4 h-4 text-primary" />
										</div>
										<div>
											<h3 className="text-base font-semibold text-foreground">{t('adminDashboard.accessPermissions.title')}</h3>
											<p className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('adminDashboard.accessPermissions.subtitle')}</p>
										</div>
									</div>
									<div className="px-2 py-0.5 rounded-full bg-green-500/10 border border-green-500/20 flex items-center gap-1.5">
										<div className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse"></div>
										<span className="text-[10px] font-medium text-green-600 dark:text-green-400 uppercase tracking-wider">{t('adminDashboard.accessPermissions.active')}</span>
									</div>
								</div>

								<div className="flex-1 flex flex-col gap-6 relative">
									{/* Access Level Section */}
									<div>
										<div className="flex justify-between items-end mb-2">
											<div>
												<p className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider mb-0.5">{t('adminDashboard.accessPermissions.currentLevel')}</p>
												<p className="text-lg font-bold text-foreground tracking-tight">{getAccessLevelName(user?.access_level || "", t)}</p>
											</div>
											<span className="text-xl font-bold text-primary/80">{getAccessProgress(user?.access_level || "")}%</span>
										</div>
										
										<div className="relative h-1.5 bg-muted rounded-full overflow-hidden">
											<div 
												className="absolute top-0 left-0 h-full bg-primary rounded-full transition-all duration-1000 ease-out"
												style={{ width: `${getAccessProgress(user?.access_level || "")}%` }}
											>
												<div className="absolute top-0 right-0 bottom-0 w-full bg-gradient-to-r from-transparent to-white/30"></div>
											</div>
										</div>
									</div>

									{/* System Capabilities Grid */}
									<div className="grid grid-cols-2 gap-2.5">
										{[
											{ label: t('adminDashboard.accessPermissions.workspaces'), value: (isExpert || isManager) ? t('adminDashboard.accessPermissions.unlimited') : t('adminDashboard.accessPermissions.activeWorkspaces', { count: 3 }), icon: LayoutDashboard },
											{ label: t('adminDashboard.accessPermissions.teamSharing'), value: (isExpert || isManager) ? t('adminDashboard.accessPermissions.enabled') : t('adminDashboard.accessPermissions.disabled'), icon: Users },
											{ label: t('adminDashboard.accessPermissions.modelQuota'), value: (isExpert || isManager) ? t('adminDashboard.accessPermissions.unlimited') : t('adminDashboard.accessPermissions.standardLimit'), icon: Brain },
											{ label: t('adminDashboard.accessPermissions.computePower'), value: isExpert ? t('adminDashboard.accessPermissions.highPerformance') : t('adminDashboard.accessPermissions.standard'), icon: Zap },
										].map((cap) => (
											<div key={cap.label} className="p-2.5 rounded-lg bg-background border border-border/50 hover:border-primary/20 transition-colors group/cap">
												<div className="flex items-center gap-2 mb-1">
													<cap.icon className="w-3 h-3 text-muted-foreground group-hover/cap:text-primary transition-colors" />
													<span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">{cap.label}</span>
												</div>
												<p className="text-sm font-bold text-foreground">{cap.value}</p>
											</div>
										))}
									</div>

									{/* Layers Section - Clean List */}
									<div className="flex-1">
										<p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-2">
											<Layers className="w-3 h-3" />
											{t('adminDashboard.accessPermissions.availableFeatures')}
										</p>
										<div className="space-y-2">
											{getAvailableLayers(user?.access_level || "", t).map((layer) => (
												<div key={layer} className="flex items-center gap-2.5 group/item">
													<div className="w-4 h-4 rounded-full bg-primary/10 flex items-center justify-center group-hover/item:bg-primary/20 transition-colors flex-shrink-0">
														<CheckCircle className="w-2.5 h-2.5 text-primary" />
													</div>
													<span className="text-sm text-foreground/80 group-hover/item:text-foreground transition-colors">{layer}</span>
												</div>
											))}
										</div>
									</div>

									{user?.access_level !== "expert" && (
										<div className="mt-auto pt-3 border-t border-border/50">
											<div className="flex items-center gap-2.5 text-amber-600 dark:text-amber-400 bg-amber-50/50 dark:bg-amber-900/10 p-2.5 rounded-lg border border-amber-100 dark:border-amber-800/30">
												<AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" />
												<p className="text-[10px] font-medium leading-relaxed">
													{t('adminDashboard.accessPermissions.upgradeMessage')}
												</p>
											</div>
										</div>
									)}
								</div>
							</div>
						</div>

						{/* Quick action buttons for common tasks */}
						<div className="mt-5">
							<div className="flex items-center gap-3 mb-3">
								<div className="p-2 bg-muted rounded-lg">
									<Zap className="w-4 h-4 text-muted-foreground" />
								</div>
								<div>
									<h3 className="text-base font-semibold text-foreground">{t('adminDashboard.quickActions.title')}</h3>
									<p className="text-[10px] text-muted-foreground uppercase tracking-wider">{t('adminDashboard.quickActions.subtitle')}</p>
								</div>
							</div>

							<div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
								{[
									{ icon: MapPin, label: t('adminDashboard.quickActions.interactiveMap'), description: t('adminDashboard.quickActions.viewRiskMap'), path: "/app/map" },
									{ icon: Brain, label: t('adminDashboard.quickActions.riskModels'), description: t('adminDashboard.quickActions.manageRiskModels'), path: "/app/model-dashboard" },
									{ icon: Settings, label: t('adminDashboard.quickActions.settings'), description: t('adminDashboard.quickActions.configurePreferences'), path: "/app/settings" },
								].map((action) => (
									<button
										key={action.path}
										onClick={() => navigate(action.path)}
										className="group flex items-center gap-3 p-3 bg-card border border-border rounded-xl shadow-sm hover:shadow-md hover:border-muted-foreground/30 transition-all duration-300 text-left"
									>
										<div className="p-2.5 rounded-lg bg-muted group-hover:bg-muted/80 transition-colors duration-300">
											<action.icon className="w-4 h-4 text-muted-foreground" />
										</div>
										<div className="flex-1 min-w-0">
											<p className="text-sm font-semibold text-foreground">{action.label}</p>
											<p className="text-[10px] text-muted-foreground">{action.description}</p>
										</div>
										<ChevronRight className="w-4 h-4 text-muted-foreground group-hover:text-foreground group-hover:translate-x-1 transition-all" />
									</button>
								))}
							</div>
						</div>
					</TabPanel>

					{/* Risk assessment models management (admin and manager) */}
					<Authorized access={["expert", "manager"]}>
						<TabPanel value={tabValue} index={getTabIndex("models")}>
							<Suspense fallback={<TabLoadingFallback />}>
								<ModelsManagement onModelAction={handleModelAction} />
							</Suspense>
						</TabPanel>
					</Authorized>

					{/* Simulation engine webservices management (admin only) */}
					{/* Simulation Engine - visible to all, editable by experts only */}
					<TabPanel value={tabValue} index={getTabIndex("webservices")}>
						<Suspense fallback={<TabLoadingFallback />}>
							<WebservicesManagement 
								onWebserviceAction={handleWebserviceAction} 
								readOnly={!isExpert}
							/>
						</Suspense>
					</TabPanel>

					{/* Pylovo Grid Engine management - visible to all, editable by experts only */}
					<TabPanel value={tabValue} index={getTabIndex("pylovo")}>
						<Suspense fallback={<TabLoadingFallback />}>
							<PylovoManagement readOnly={!isExpert} />
						</Suspense>
					</TabPanel>

					{/* User feedback management (admin only) */}
					<Authorized access={["expert"]}>
						<TabPanel value={tabValue} index={getTabIndex("feedback")}>
							<Suspense fallback={<TabLoadingFallback />}>
								<FeedbackManagement onFeedbackAction={handleFeedbackAction} />
							</Suspense>
						</TabPanel>
					</Authorized>

					{/* System user management (admin and manager) */}
					<Authorized access={["expert", "manager"]}>
						<TabPanel value={tabValue} index={getTabIndex("users")}>
							<Suspense fallback={<TabLoadingFallback />}>
								<UserManagement onUsersMutated={refreshUsersCount} />
							</Suspense>
						</TabPanel>
					</Authorized>
				</div>
			</div>
		</div>
	);
};
