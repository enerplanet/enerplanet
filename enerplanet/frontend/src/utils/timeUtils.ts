/**
 * Format elapsed time dynamically based on duration
 * - 0-59 seconds: "45s"
 * - 1-59 minutes: "12m 34s" 
 * - 1+ hours: "2h 15m 30s"
 */
export function formatElapsedTime(elapsedSeconds: number): string {
	const seconds = Math.floor(elapsedSeconds);
	
	if (seconds < 60) {
		return `${seconds}s`;
	}
	
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	
	if (minutes < 60) {
		return `${minutes}m ${remainingSeconds}s`;
	}
	
	const hours = Math.floor(minutes / 60);
	const remainingMinutes = minutes % 60;
	
	return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
}
