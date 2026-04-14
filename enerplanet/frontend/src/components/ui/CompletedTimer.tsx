import React from 'react';
import { formatElapsedTime } from '@/utils/timeUtils';
import { CheckCircle2, XCircle, StopCircle } from 'lucide-react';
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
	
	const getStatusIcon = () => {
		switch (status) {
			case 'completed':
				return <CheckCircle2 className="w-3 h-3 text-muted-foreground" />;
			case 'failed':
				return <XCircle className="w-3 h-3 text-muted-foreground" />;
			case 'cancelled':
				return <StopCircle className="w-3 h-3 text-muted-foreground" />;
			default:
				return <CheckCircle2 className="w-3 h-3 text-muted-foreground" />;
		}
	};

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
					{getStatusIcon()}
					<span className="font-mono">{formatElapsedTime(totalSeconds)}</span>
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