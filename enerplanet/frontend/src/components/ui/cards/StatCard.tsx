import React from 'react';

interface StatCardProps {
	title: string;
	value: string | number;
	subtitle?: string;
	icon?: React.ReactNode;
	className?: string;
}

const StatCard: React.FC<StatCardProps> = ({ 
	title, 
	value, 
	subtitle,
	icon,
	className = ""
}) => {
	return (
		<div className={`bg-card rounded-lg p-3 shadow-sm border border-border hover:shadow-md transition-all duration-200 ${className}`}>
			<div className="flex items-center gap-3">
				{icon && (
					<div className="p-2 bg-muted rounded-lg flex-shrink-0">
						{icon}
					</div>
				)}
				<div className="flex-1 min-w-0">
					<p className="text-xs text-muted-foreground font-medium">{title}</p>
					<p className="text-lg font-bold text-foreground">{value}</p>
					{subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
				</div>
			</div>
		</div>
	);
};

export default StatCard;
