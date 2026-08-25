import type { ModelStats } from "@/features/model-dashboard/services/modelService";
import { StatsStrip } from "@/components/ui/StatsStrip";
import { useTranslation } from "@spatialhub/i18n";

interface ModelStatsSummaryProps {
	stats: ModelStats;
	className?: string;
}

// Compact inline stats strip (label + value pairs) shown in the table toolbar area.
export function ModelStatsSummary({ stats, className = "" }: ModelStatsSummaryProps) {
	const { t } = useTranslation();

	const inProgress = (stats.queue || 0) + (stats.running || 0);
	const isUnlimited = stats.is_unlimited ?? (stats.model_limit ?? 0) === 0;
	const isAtLimit = !isUnlimited && stats.total >= (stats.model_limit ?? 0);
	const limitText = isUnlimited ? t("dashboard.stats.unlimited") : `${stats.total}/${stats.model_limit}`;

	return (
		<StatsStrip
			className={className}
			items={[
				{ label: t("dashboard.stats.totalModels"), value: stats.total },
				{ label: t("dashboard.stats.inProgress"), value: inProgress },
				{ label: t("dashboard.stats.completed"), value: stats.completed },
				{ label: t("dashboard.stats.modelLimit"), value: limitText, highlight: isAtLimit },
			]}
		/>
	);
}
