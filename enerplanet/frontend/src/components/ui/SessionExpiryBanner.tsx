import React, { useEffect, useState } from "react";
import { Clock, RefreshCw, LogOut } from "lucide-react";
import { Button } from "@spatialhub/ui";
import { useSessionTimer } from "@/hooks/useSessionTimer";
import { useAuthStore } from "@/store/auth-store";
import { useNavigate } from "react-router-dom";

const BANNER_THRESHOLD_SECONDS = 180; // Show banner when <= 3 minutes remain

export const SessionExpiryBanner: React.FC = () => {
  const { isWarning, resetTimer, formatTime, isActive, getRemainingSeconds } = useSessionTimer();
  const logout = useAuthStore(state => state.logout);
  const navigate = useNavigate();

  const [localSeconds, setLocalSeconds] = useState(0);

  useEffect(() => {
    if (!isActive || !isWarning) return;

    let animationFrameId: number;
    let lastTick = 0;

    const tick = (timestamp: number) => {
      // Throttle to roughly once per second
      if (timestamp - lastTick > 1000) {
        setLocalSeconds(getRemainingSeconds());
        lastTick = timestamp;
      }
      animationFrameId = requestAnimationFrame(tick);
    };

    animationFrameId = requestAnimationFrame(tick);

    return () => cancelAnimationFrame(animationFrameId);
  }, [isActive, isWarning, getRemainingSeconds]);

  if (!isActive || !isWarning || localSeconds > BANNER_THRESHOLD_SECONDS) return null;

  const handleLogout = () => {
    logout();
    navigate("/login");
  };

  const isUrgent = localSeconds <= 60;

  return (
    <div
      className={`fixed top-0 left-0 right-0 z-[100] flex items-center justify-center gap-4 px-4 py-2 text-sm font-medium shadow-md transition-colors ${
        isUrgent
          ? "bg-red-600 text-white"
          : "bg-amber-500 text-amber-950"
      }`}
    >
      <Clock className="h-4 w-4 shrink-0" />
      <span>
        Your session expires in <strong>{formatTime(localSeconds)}</strong>
      </span>
      <Button
        size="sm"
        variant={isUrgent ? "secondary" : "outline"}
        className="h-7 gap-1.5 text-xs"
        onClick={resetTimer}
      >
        <RefreshCw className="h-3 w-3" />
        Extend Session
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className={`h-7 gap-1.5 text-xs ${isUrgent ? "text-white hover:text-white/80" : ""}`}
        onClick={handleLogout}
      >
        <LogOut className="h-3 w-3" />
        Logout
      </Button>
    </div>
  );
};
