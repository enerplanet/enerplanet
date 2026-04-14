export const parseDate = (date: string | Date): Date => {
	if (date instanceof Date) return date;
	if (typeof date === 'string') {
		return new Date(date);
	}
	return new Date();
};

export const formatDate = (date: string | Date): string => {
	const dateObj = parseDate(date);
	return dateObj.toLocaleDateString('en-GB');
};

export const formatDateTime = (date: string | Date): string => {
	const dateObj = parseDate(date);
	return dateObj.toLocaleString("en-GB", {
		year: "numeric",
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
		hour12: false,
	});
};

/**
 * Format date with full details (used in notifications, feedback, etc.)
 * Format: "09 Jan 2025, 14:30"
 */
export const formatDateTime24h = (date: string | Date): string => {
	const dateObj = parseDate(date);
	return dateObj.toLocaleString('en-GB', {
		day: '2-digit',
		month: 'short',
		year: 'numeric',
		hour: '2-digit',
		minute: '2-digit',
		hour12: false,
	});
};

const formatDateShort = (date: string | Date): string => {
	const dateObj = parseDate(date);
	return dateObj.toLocaleDateString("en-GB", {
		month: "short",
		day: "numeric",
		year: "2-digit",
	});
};

export const formatTimeAgo = (date: string | Date): string => {
	if (!date) {
		return 'Unknown';
	}

	const dateObj = parseDate(date);
	
	// Handle invalid dates
	const timestamp = dateObj.getTime();
	if (Number.isNaN(timestamp)) {
		return 'Unknown';
	}
	
	const now = Date.now();
	
	// Calculate difference in milliseconds
	const diffInMs = now - timestamp;
	
	// Handle future dates
	if (diffInMs < 0) {
		return "Just now";
	}
	
	const diffInSeconds = Math.floor(diffInMs / 1000);
	const diffInMinutes = Math.floor(diffInSeconds / 60);
	
	// Very recent (less than 60 seconds)
	if (diffInSeconds < 60) {
		return "Just now";
	}
	
	if (diffInMinutes === 1) return "1 min ago";
	if (diffInMinutes < 60) return `${diffInMinutes} mins ago`;
	
	const diffInHours = Math.floor(diffInMinutes / 60);
	if (diffInHours === 1) return "1 hour ago";
	if (diffInHours < 24) return `${diffInHours} hours ago`;
	
	const diffInDays = Math.floor(diffInHours / 24);
	if (diffInDays === 1) return "1 day ago";
	if (diffInDays < 7) return `${diffInDays} days ago`;
	
	if (diffInDays < 30) {
		const weeks = Math.floor(diffInDays / 7);
		return weeks === 1 ? "1 week ago" : `${weeks} weeks ago`;
	}
	
	return formatDateShort(dateObj);
};
