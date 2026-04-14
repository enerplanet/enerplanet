type AccessLevel = "very_low" | "intermediate" | "manager" | "expert";

interface AccessLevelConfig {
    color: string;
    iconColor: string;
    label: string;
}

const TEXT_WHITE = "text-white";

const ACCESS_LEVEL_CONFIG: Record<AccessLevel, AccessLevelConfig> = {
    expert: {
        color: "bg-slate-700 text-white border-slate-800",
        iconColor: TEXT_WHITE,
        label: "Expert"
    },
    manager: {
        color: "bg-slate-800 text-white border-slate-900",
        iconColor: TEXT_WHITE,
        label: "Manager"
    },
    intermediate: {
        color: "bg-slate-600 text-white border-slate-700",
        iconColor: TEXT_WHITE,
        label: "Intermediate"
    },
    very_low: {
        color: "bg-slate-400 text-white border-slate-500",
        iconColor: TEXT_WHITE,
        label: "Basic"
    }
};

export const getAccessLevelColor = (level: string): string =>
    ACCESS_LEVEL_CONFIG[level as AccessLevel]?.color ?? "bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 border-gray-200 dark:border-gray-700";

export const getAccessLevelName = (level: string): string =>
    ACCESS_LEVEL_CONFIG[level as AccessLevel]?.label ?? "Unknown";

export const getAccessLevelIconColor = (level: string): string =>
    ACCESS_LEVEL_CONFIG[level as AccessLevel]?.iconColor ?? "text-gray-600 dark:text-gray-300";

export const isExpert = (user: { access_level?: string } | null): boolean =>
    user?.access_level === "expert";

export const isManager = (user: { access_level?: string } | null): boolean =>
    user?.access_level === "manager";

export const isExpertOrManager = (user: { access_level?: string } | null): boolean =>
    user?.access_level === "expert" || user?.access_level === "manager";
