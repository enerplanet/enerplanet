import React, { useMemo } from 'react';
import { formatElapsedTime } from '@/utils/timeUtils';
import { formatDateTime24h, parseDate } from '@/utils/dateHelpers';
import { Clock } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@spatialhub/ui';
import { useSecondTicker } from '@/hooks/use-second-ticker';

interface ElapsedTimerProps {
	startTime: string | Date;
	isRunning?: boolean;
	className?: string;
	showBlinkingIcon?: boolean;
}

const ElapsedTimer: React.FC<ElapsedTimerProps> = ({ 
	startTime, 
	isRunning = true, 
	className = "",
	showBlinkingIcon = false
}) => {
	const getStartTimeMs = (time: string | Date): number => {
		if (!time) return 0;
		const parsed = parseDate(time).getTime();
		return Number.isNaN(parsed) ? 0 : parsed;
	};

	const calculateElapsed = (startMs: number, nowMs: number): number => {
		if (!startMs) return 0;
		const elapsed = Math.floor((nowMs - startMs) / 1000);
		return Math.max(0, elapsed);
	};

	const startTimeMs = useMemo(() => getStartTimeMs(startTime), [startTime]);
	const nowMs = useSecondTicker(isRunning && startTimeMs > 0);
	const elapsedTime = useMemo(
		() => (isRunning ? calculateElapsed(startTimeMs, nowMs) : 0),
		[isRunning, nowMs, startTimeMs]
	);

	if (!isRunning) return null;

	const formattedStartTime = formatDateTime24h(startTime);

	return (
		<Tooltip>
			<TooltipTrigger asChild>
				<div className={`flex items-center gap-1 text-xs text-muted-foreground cursor-pointer ${className}`}>
					<Clock className={`w-3 h-3 ${showBlinkingIcon && isRunning ? 'animate-pulse' : ''}`} />
					<span className="font-mono text-foreground">{formatElapsedTime(elapsedTime)}</span>
				</div>
			</TooltipTrigger>
			<TooltipContent>
				<div className="text-center">
					<div className="font-semibold">Elapsed Time</div>
					<div className="text-xs">Started at {formattedStartTime}</div>
					<div className="text-xs">Running for {formatElapsedTime(elapsedTime)}</div>
				</div>
			</TooltipContent>
		</Tooltip>
	);
};

export default ElapsedTimer;
