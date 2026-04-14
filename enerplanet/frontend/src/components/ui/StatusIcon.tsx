import React from 'react';
import { ModelStatus, IconSize } from '@/types/models';

interface StatusIconProps {
	status: ModelStatus;
	size?: IconSize;
	className?: string;
}

const StatusIcon: React.FC<StatusIconProps> = ({ status, size = "small", className = "" }) => {
	const iconSize = size === "small" ? "w-3 h-3" : "w-4 h-4";
	const iconClasses = `${iconSize} mr-1 ${className}`;
	
	switch (status) {
		case 'draft':
			return (
				<svg className={iconClasses} fill="currentColor" viewBox="0 0 20 20">
					<path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
				</svg>
			);
		case 'queue':
			return (
				<svg className={iconClasses} fill="currentColor" viewBox="0 0 20 20">
					<path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm1-12a1 1 0 10-2 0v4a1 1 0 00.293.707l2.828 2.829a1 1 0 101.415-1.415L11 9.586V6z" clipRule="evenodd" />
				</svg>
			);
		case 'calculating':
		case 'running':
		case 'processing':
			return (
				<svg className={`${iconClasses} animate-spin`} fill="currentColor" viewBox="0 0 20 20">
					<path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd" />
				</svg>
			);
		case 'completed':
		case 'published':
			return (
				<svg className={iconClasses} fill="currentColor" viewBox="0 0 20 20">
					<path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
				</svg>
			);
		case 'failed':
			return (
				<svg className={iconClasses} fill="currentColor" viewBox="0 0 20 20">
					<path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
				</svg>
			);
		case 'cancelled':
			return (
				<svg className={iconClasses} fill="currentColor" viewBox="0 0 20 20">
					<path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm0-2a6 6 0 100-12 6 6 0 000 12zm0-13a1 1 0 011 1v4a1 1 0 11-2 0V4a1 1 0 011-1z" clipRule="evenodd" />
				</svg>
			);
		case 'modified':
			return (
				<svg className={iconClasses} fill="currentColor" viewBox="0 0 20 20">
					<path d="M13.586 3.586a2 2 0 112.828 2.828l-.793.793-2.828-2.828.793-.793zM11.379 5.793L3 14.172V17h2.828l8.38-8.379-2.83-2.828z" />
				</svg>
			);
		default:
			return (
				<svg className={iconClasses} fill="currentColor" viewBox="0 0 20 20">
					<path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
				</svg>
			);
	}
};

export default StatusIcon;
