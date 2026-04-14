import { useState, useEffect } from 'react';
import { formatTimeAgo } from '@/utils/dateHelpers';

interface TimeAgoProps {
  date: string | Date;
  className?: string;
}

export const TimeAgo = ({ date, className }: TimeAgoProps) => {
  const [timeAgo, setTimeAgo] = useState(() => formatTimeAgo(date));

  useEffect(() => {
    // Update immediately
    setTimeAgo(formatTimeAgo(date));

    // Update every minute
    const intervalId = setInterval(() => {
      setTimeAgo(formatTimeAgo(date));
    }, 60000);

    return () => clearInterval(intervalId);
  }, [date]);

  return <span className={className}>{timeAgo}</span>;
};
