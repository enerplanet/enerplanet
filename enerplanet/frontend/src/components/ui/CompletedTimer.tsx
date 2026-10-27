import React from 'react';
import { formatElapsedTime } from '@/utils/timeUtils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@spatialhub/ui';
import { useTranslation } from '@spatialhub/i18n';

interface CompletedTimerProps {
	totalSeconds: number;
	status: 'completed' | 'failed' | 'cancelled';
	className?: string;
}

const CompletedTimer: React.FC<CompletedTimerProps> = ({ 
	totalSeconds, 
	status,
	className = "" 
}) => {
	const { t } = useTranslation();
	
	const getStatusColor = () => {
		return 'text-foreground';
	};

	const getTooltipMessage = () => {
		const formattedTime = formatElapsedTime(totalSeconds);
		switch (status) {
			case 'completed':
				return t('notifications.completedIn', { time: formattedTime });
			case 'failed':
				return t('notifications.failedAfter', { time: formattedTime });
			case 'cancelled':
				return t('notifications.cancelledAfter', { time: formattedTime });
			default:
				return t('notifications.completedIn', { time: formattedTime });
		}
	};

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<div className={`flex items-center gap-1 text-xs cursor-pointer ${getStatusColor()} ${className}`}>
					<span className="tabular-nums text-muted-foreground">{formatElapsedTime(totalSeconds)}</span>
				</div>
			</TooltipTrigger>
			<TooltipContent>
				<div className="text-center">
					<div className="font-semibold">{t('notifications.totalExecutionTime')}</div>
					<div className="text-xs">{getTooltipMessage()}</div>
				</div>
			</TooltipContent>
		</Tooltip>
	);
};

export default CompletedTimer;