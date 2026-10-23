import type { FC } from 'react';
import { useTranslation } from '@spatialhub/i18n';
import { cn } from '@/lib/utils';
import { useAreaPreparationStore, type PreparationStage } from './useAreaPreparation';

/** One segment per stage: done ones filled, the current one pulsing, and the current stage's name below. */
export const PreparationBar: FC<{ stage: PreparationStage }> = ({ stage }) => {
  const { t } = useTranslation();
  const current = stage.index - 1;
  return (
    <div className="w-64 space-y-2" role="progressbar" aria-valuemin={0} aria-valuemax={stage.count} aria-valuenow={current}>
      <div className="flex gap-1">
        {Array.from({ length: stage.count }, (_, i) => (
          <span
            key={i}
            className={cn(
              'h-1.5 flex-1 rounded-full',
              i < current && 'bg-primary',
              i === current && 'bg-primary/60 animate-pulse',
              i > current && 'bg-muted',
            )}
          />
        ))}
      </div>
      <p className="text-foreground text-center text-xs font-medium">
        {t(`simulation.prepare3d.stages.${stage.key}`, stage.label)}
      </p>
    </div>
  );
};

/** The area's 3D preparation progress while a run reports its stage, otherwise nothing. */
export const PreparationProgress: FC = () => {
  const status = useAreaPreparationStore((s) => s.status);
  const stage = useAreaPreparationStore((s) => s.stage);
  return status === 'running' && stage ? <PreparationBar stage={stage} /> : null;
};
