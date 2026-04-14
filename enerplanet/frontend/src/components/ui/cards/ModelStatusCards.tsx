import React from 'react';
import { FileText, Clock, Loader, CheckCircle, PlayCircle } from 'lucide-react';
import StatCard from './StatCard';
import { useTranslation } from '@spatialhub/i18n';

interface ModelStatusCounts {
	draft: number;
	inQueue: number;
	calculating: number;
	finished: number;
	published: number;
}

interface ModelStatusCardsProps {
	statusCounts: ModelStatusCounts;
	className?: string;
}

const ModelStatusCards: React.FC<ModelStatusCardsProps> = ({ 
	statusCounts, 
	className = "" 
}) => {
	const { t } = useTranslation();
	
	return (
		<div className={`grid grid-cols-2 md:grid-cols-5 gap-3 ${className}`}>
			<StatCard
				title={t('modelsManagement.status.draft')}
				value={statusCounts.draft}
				icon={<FileText className="w-4 h-4 text-muted-foreground" />}
			/>
			<StatCard
				title={t('modelsManagement.status.inQueue')}
				value={statusCounts.inQueue}
				icon={<Clock className="w-4 h-4 text-muted-foreground" />}
			/>
			<StatCard
				title={t('modelsManagement.status.inProgress')}
				value={statusCounts.calculating}
				icon={<Loader className="w-4 h-4 text-muted-foreground animate-spin" />}
			/>
			<StatCard
				title={t('modelsManagement.status.completed')}
				value={statusCounts.finished}
				icon={<CheckCircle className="w-4 h-4 text-muted-foreground" />}
			/>
			<StatCard
				title={t('modelsManagement.status.published')}
				value={statusCounts.published}
				icon={<PlayCircle className="w-4 h-4 text-muted-foreground" />}
			/>
		</div>
	);
};

export default ModelStatusCards;
