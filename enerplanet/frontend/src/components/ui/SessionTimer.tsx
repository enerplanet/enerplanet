import React, { useEffect, useState } from "react";
import { Clock } from "lucide-react";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
  Button,
} from "@spatialhub/ui";
import { useSessionTimer } from "@/hooks/useSessionTimer";

interface SessionTimerProps {
  warningThreshold?: number; // Minutes before showing warning (default: 5)
  compact?: boolean; // Compact mode for dropdown display
}

/**
 * Session timer display component.
 * Uses the shared useSessionTimer hook — no duplicate timer logic.
 */
export const SessionTimer: React.FC<SessionTimerProps> = ({
  warningThreshold = 5,
  compact = false,
}) => {
  const { isWarning, resetTimer, formatTime, isActive, getRemainingSeconds } =
    useSessionTimer({ warningThreshold });

  const [localSeconds, setLocalSeconds] = useState(0);

  useEffect(() => {
    if (!isActive) return;

    let animationFrameId: number;
    let lastTick = 0;

    const tick = (timestamp: number) => {
      // Update local state roughly once per second
      if (timestamp - lastTick > 1000) {
        setLocalSeconds(getRemainingSeconds());
        lastTick = timestamp;
      }
      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(animationFrameId);
  }, [isActive, getRemainingSeconds]);

  if (!isActive) return null;

  const WARNING_TEXT_CLASS = 'text-red-600 dark:text-red-400';

  // Compact mode for profile dropdown
  if (compact) {
    return (
      <button
        type="button"
        className={`flex items-center justify-between w-full cursor-pointer rounded-md px-2 py-1.5 transition-colors ${
          isWarning
            ? 'bg-red-50 dark:bg-red-900/20'
            : 'bg-gray-50 dark:bg-gray-700/50 hover:bg-gray-100 dark:hover:bg-gray-700'
        }`}
        onClick={resetTimer}
      >
        <div className="flex items-center gap-2">
          <div className="relative">
            <Clock
              className={`w-4 h-4 ${
                isWarning ? WARNING_TEXT_CLASS : 'text-gray-500 dark:text-gray-400'
              }`}
            />
            {isWarning && (
              <div className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
            )}
          </div>
          <span className="text-xs text-gray-600 dark:text-gray-300">Session</span>
        </div>
        <span className={`text-xs font-mono font-medium ${
          isWarning ? WARNING_TEXT_CLASS : 'text-gray-900 dark:text-white'
        }`}>
          {formatTime(localSeconds)}
        </span>
      </button>
    );
  }

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant="secondary"
          className={`relative group cursor-pointer px-2 py-1.5 rounded-md transition-colors duration-normal ${
            isWarning ? 'bg-red-50 hover:bg-red-100 dark:bg-red-900/20 dark:hover:bg-red-900/30' : ''
          }`}
          onClick={resetTimer}
        >
          <div className="flex items-center gap-1.5">
            <div className="relative">
              <Clock
                className={`w-4 h-4 transition-colors ${
                  isWarning ? WARNING_TEXT_CLASS : 'text-foreground'
                }`}
              />
              {isWarning && (
                <div className="absolute -top-1 -right-1 w-1.5 h-1.5 bg-red-500 rounded-full animate-pulse" />
              )}
            </div>
            <span className={`text-xs font-mono ${
              isWarning ? `${WARNING_TEXT_CLASS} font-semibold` : 'text-foreground'
            }`}>
              {formatTime(localSeconds)}
            </span>
          </div>
        </Button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <div className="space-y-1">
          <p className="font-semibold">
            {isWarning ? '⚠️ Session Expiring Soon' : 'Session Timer'}
          </p>
          <p className="text-xs">
            {isWarning
              ? `Your session will expire in ${formatTime(localSeconds)}. Click to extend.`
              : `Time remaining: ${formatTime(localSeconds)}`
            }
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  );
};
