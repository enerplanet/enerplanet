import React from "react";
import {
	User,
	Mail,
	Shield,
	AlertTriangle,
	Users,
	Brain,
	Layers,
	Zap,
	LayoutDashboard,
	CheckCircle,
} from "lucide-react";
import { useTranslation } from "@spatialhub/i18n";
import { useAuth } from "@/providers/auth-provider";
import { useAdminUsersCount } from "./hooks/useAdminUsersCount";
import {
	buildStatsCards,
	getAccessLevelColor,
	getAccessLevelName,
	getAccessProgress,
	getAvailableLayers,
} from "./utils/dashboardHelpers";

/**
 * The personal overview (stats, profile, access permissions). Was the first tab
 * of the Admin Dashboard; pulled out because it belongs to user settings.
 * Kept wired and exported, currently not rendered anywhere.
 */
export const OverviewPanel: React.FC = () => {
	const { t } = useTranslation();
	const { user } = useAuth();
	const isExpert = user?.access_level === "expert";
	const isManager = user?.access_level === "manager";
	const canManageUsers = isExpert || isManager;
	const { usersCount, usersCountLoading, onlineCount } = useAdminUsersCount(canManageUsers);
	const statsCards = buildStatsCards(user, canManageUsers, usersCount, usersCountLoading, t, onlineCount);

	return (
		<div>
			<div className="mb-5 grid grid-cols-2 md:grid-cols-4 gap-3">
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
		</div>
	);
};

export default OverviewPanel;