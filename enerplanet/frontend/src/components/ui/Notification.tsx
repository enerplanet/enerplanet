import React from 'react';
import { CheckCircle, XCircle, AlertTriangle, X } from "lucide-react";

interface NotificationProps {
	isOpen: boolean;
	message: string;
	severity: "success" | "error" | "warning" | "info";
	onClose: () => void;
	duration?: number;
}

/**
 * Shared notification component for displaying toast messages
 */
const Notification: React.FC<NotificationProps> = ({
	isOpen,
	message,
	severity,
	onClose,
	duration = 5000
}) => {
	// Auto-hide after duration
	React.useEffect(() => {
		if (isOpen && duration > 0) {
			const timer = setTimeout(onClose, duration);
			return () => clearTimeout(timer);
		}
	}, [isOpen, duration, onClose]);

	if (!isOpen) return null;

	const getNotificationIcon = (severity: string) => {
		switch (severity) {
			case "success":
				return <CheckCircle className="w-5 h-5" />;
			case "error":
				return <XCircle className="w-5 h-5" />;
			case "warning":
				return <AlertTriangle className="w-5 h-5" />;
			default:
				return <CheckCircle className="w-5 h-5" />;
		}
	};

	const getNotificationColors = (severity: string) => {
		switch (severity) {
			case "success":
				return "bg-green-50 border-green-200 text-green-800";
			case "error":
				return "bg-red-50 border-red-200 text-red-800";
			case "warning":
				return "bg-yellow-50 border-yellow-200 text-yellow-800";
			case "info":
				return "bg-blue-50 border-blue-200 text-blue-800";
			default:
				return "bg-gray-50 border-gray-200 text-gray-700";
		}
	};

	return (
		<div className="fixed top-16 right-4 z-50 animate-slide-in">
			<div className={`flex items-center gap-3 px-4 py-3 rounded-lg border shadow-lg max-w-md ${getNotificationColors(severity)}`}>
				{getNotificationIcon(severity)}
				<span className="text-sm font-medium flex-1">{message}</span>
				<button 
					onClick={onClose} 
					className="ml-2 text-current hover:opacity-70 transition-opacity"
				>
					<X className="w-4 h-4" />
				</button>
			</div>
		</div>
	);
};

export default Notification;
