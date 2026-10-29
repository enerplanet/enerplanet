import React, { useState, lazy, Suspense } from "react";
import SectionShell from "@/components/ui/SectionShell";
import { useTranslation } from "@spatialhub/i18n";
import { useDocumentTitle } from "@/hooks/use-document-title";
import { useAuth } from "@/providers/auth-provider";
import { Authorized } from "@/middleware/authorized";
import { useAdminUsersCount } from "./hooks/useAdminUsersCount";
import { useAdminModelActions } from "./hooks/useAdminModelActions";
import {
	dashboardTabIcons,
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
			<div className="md-fade-in p-3 md:p-4">{children}</div>
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
	
	const { user } = useAuth();

	// State management
	const isExpert = user?.access_level === "expert";
	const isManager = user?.access_level === "manager";
	const canManageUsers = isExpert || isManager;
	const { refreshUsersCount } = useAdminUsersCount(canManageUsers);

	// Tab navigation configuration
	const allTabs = getDashboardTabs(t, canManageUsers, isExpert);
	const tabs = allTabs.filter((tab) => tab.show);
	// Simulation Engine is the landing tab; default to its index.
	const [tabValue, setTabValue] = useState(() => Math.max(0, tabs.findIndex((tab) => tab.key === "webservices")));

	// Component action handlers for child component events
	const handleModelAction = useAdminModelActions();

	const handleWebserviceAction = () => {};

	const handleFeedbackAction = () => {};

	// Create tab index mapping for TabPanels
	const getTabIndex = (key: string) => {
		return tabs.findIndex(tab => tab.key === key);
	};

	return (
		<SectionShell
			title={t('adminDashboard.title')}
			subtitle={t('adminDashboard.managePlatform')}
			tabs={tabs.map(tab => ({ key: tab.key, label: tab.label, icon: dashboardTabIcons[tab.key] }))}
			activeTab={tabs[tabValue]?.key}
			onTabChange={(key) => {
				const idx = tabs.findIndex(tab => tab.key === key);
				if (idx !== -1) setTabValue(idx);
			}}
		>
			<div className="md-scope space-y-4">


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
					</SectionShell>
					);
					};
