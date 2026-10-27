import type { ModelStats } from "@/features/model-dashboard/services/modelService";
import { useTranslation } from "@spatialhub/i18n";

interface ModelStatsSummaryProps {
	stats: ModelStats;
	className?: string;
}

// One line of model counts for the dashboard toolbar; the limit shows only when one applies.
export function ModelStatsSummary({ stats, className = "" }: ModelStatsSummaryProps) {
	const { t } = useTranslation();

	const inProgress = (stats.queue || 0) + (stats.running || 0);
	const isUnlimited = stats.is_unlimited ?? (stats.model_limit ?? 0) === 0;
	const isAtLimit = !isUnlimited && stats.total >= (stats.model_limit ?? 0);
	const parts = [
		t("dashboard.stats.modelsCount", { count: stats.total }),
		t("dashboard.stats.inProgressCount", { count: inProgress }),
		t("dashboard.stats.completedCount", { count: stats.completed }),
	];

	return (
		<span className={`whitespace-nowrap text-sm text-muted-foreground ${className}`}>
			{parts.join(" · ")}
			{!isUnlimited && (
				<span className={isAtLimit ? "font-medium text-red-700 dark:text-red-400" : ""}>
					{" · "}
					{t("dashboard.stats.limitUsed", { used: stats.total, limit: stats.model_limit })}
				</span>
			)}
		</span>
	);
}
