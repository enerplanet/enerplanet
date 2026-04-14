import type { FC } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';

interface Step {
  id: string;
  label: string;
}

interface StepIndicatorProps {
  steps: Step[];
  currentStep: number;
}

const StepIndicator: FC<StepIndicatorProps> = ({ steps, currentStep }) => {
  return (
    <div className="flex items-center w-full">
      {steps.map((step, index) => (
        <div key={step.id} className="flex items-center flex-1 last:flex-none">
          {/* Step circle + label */}
          <div className="flex flex-col items-center gap-1">
            <div
              className={cn(
                'w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold transition-all duration-300 shrink-0',
                index < currentStep && 'bg-primary text-primary-foreground shadow-sm',
                index === currentStep && 'ring-2 ring-primary ring-offset-2 ring-offset-card bg-primary text-primary-foreground shadow-md',
                index > currentStep && 'bg-muted text-muted-foreground',
              )}
            >
              {index < currentStep ? <Check className="w-3.5 h-3.5" /> : index + 1}
            </div>
            <span
              className={cn(
                'text-[10px] font-medium transition-colors duration-300 whitespace-nowrap',
                index <= currentStep ? 'text-foreground' : 'text-muted-foreground',
              )}
            >
              {step.label}
            </span>
          </div>

          {/* Connector line */}
          {index < steps.length - 1 && (
            <div className="flex-1 mx-2 mt-[-14px]">
              <div
                className={cn(
                  'h-[2px] w-full rounded-full transition-all duration-500',
                  index < currentStep ? 'bg-primary' : 'bg-border',
                )}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default StepIndicator;
