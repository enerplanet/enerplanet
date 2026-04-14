import React from 'react';
import { FileText, Clock, Loader2, CheckCircle, Globe, Gauge } from 'lucide-react';
import { useTranslation } from '@spatialhub/i18n';

interface ModelStats {
	total: number;
	draft: number;
	queue?: number;
	running?: number;
	completed: number;
	published?: number;
	model_limit?: number;
	remaining?: number;
	is_unlimited?: boolean;
}

interface ModelStatsCardsProps {
	stats: ModelStats;
	className?: string;
	variant?: "default" | "compact";
}

const ModelStatsCards: React.FC<ModelStatsCardsProps> = ({
	stats,
	className = "",
	variant = "default",
}) => {
	const { t } = useTranslation();
	const inProgress = (stats.queue || 0) + (stats.running || 0);
	const isCompact = variant === "compact";

	// Calculate limit display
	const modelLimit = stats.model_limit ?? 0;
	const isUnlimited = stats.is_unlimited ?? modelLimit === 0;
	const usagePercent = isUnlimited ? 0 : Math.min((stats.total / modelLimit) * 100, 100);
	const isNearLimit = !isUnlimited && usagePercent >= 80;
	const isAtLimit = !isUnlimited && stats.total >= modelLimit;

	const statCards = [
		{
			label: t('dashboard.stats.totalModels'),
			value: stats.total,
			icon: FileText,
		},
		{
			label: t('dashboard.stats.draft'),
			value: stats.draft,
			icon: Clock,
		},
		{
			label: t('dashboard.stats.inProgress'),
			value: inProgress,
			icon: Loader2,
		},
		{
			label: t('dashboard.stats.completed'),
			value: stats.completed,
			icon: CheckCircle,
		},
		{
			label: t('dashboard.stats.published'),
			value: stats.published || 0,
			icon: Globe,
		},
	];

	return (
		<div className={`grid grid-cols-3 md:grid-cols-6 gap-2 ${isCompact ? 'mb-2' : 'mb-3'} ${className}`}>
			{statCards.map((stat) => {
				const IconComponent = stat.icon;
				return (
					<div
						key={stat.label}
						className="group relative bg-card rounded-md p-2 shadow-sm border border-border hover:shadow-md hover:border-border/80 transition-all duration-200 overflow-hidden"
					>
						<div className="relative flex items-center gap-2">
							<div className="p-1.5 rounded-md bg-muted flex-shrink-0">
								<IconComponent className="w-3.5 h-3.5 text-muted-foreground" />
							</div>
							<div className="flex-1 min-w-0">
								<p className="text-[10px] text-muted-foreground font-medium truncate leading-tight">{stat.label}</p>
								<p className="text-sm font-bold text-foreground truncate leading-tight">{stat.value}</p>
							</div>
						</div>
					</div>
				);
			})}
			{/* Model Limit Card */}
			<div
				className={`group relative bg-card rounded-md p-2 shadow-sm border transition-all duration-200 overflow-hidden ${
					isAtLimit
						? 'border-destructive/50 bg-destructive/5'
						: isNearLimit
							? 'border-warning/50 bg-warning/5'
							: 'border-border hover:shadow-md hover:border-border/80'
				}`}
			>
				<div className="relative flex items-center gap-2">
					<div className={`p-1.5 rounded-md flex-shrink-0 ${
						isAtLimit
							? 'bg-destructive/10'
							: isNearLimit
								? 'bg-warning/10'
								: 'bg-muted'
					}`}>
						<Gauge className={`w-3.5 h-3.5 ${
							isAtLimit
								? 'text-destructive'
								: isNearLimit
									? 'text-warning'
									: 'text-muted-foreground'
						}`} />
					</div>
					<div className="flex-1 min-w-0">
						<p className="text-[10px] text-muted-foreground font-medium truncate leading-tight">
							{t('dashboard.stats.modelLimit')}
						</p>
						<p className={`text-sm font-bold truncate leading-tight ${
							isAtLimit
								? 'text-destructive'
								: isNearLimit
									? 'text-warning'
									: 'text-foreground'
						}`}>
							{isUnlimited
								? t('dashboard.stats.unlimited')
								: `${stats.total}/${modelLimit}`
							}
						</p>
					</div>
				</div>
				{/* Progress bar for non-unlimited users */}
				{!isUnlimited && (
					<div className="mt-1.5 h-1 bg-muted rounded-full overflow-hidden">
						<div
							className={`h-full rounded-full transition-all duration-300 ${
								isAtLimit
									? 'bg-destructive'
									: isNearLimit
										? 'bg-warning'
										: 'bg-primary'
							}`}
							style={{ width: `${usagePercent}%` }}
						/>
					</div>
				)}
			</div>
		</div>
	);
};

export default ModelStatsCards;
