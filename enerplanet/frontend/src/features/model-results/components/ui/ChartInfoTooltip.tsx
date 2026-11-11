import type { ReactNode } from 'react';
import { TextInfoIcon } from '@/components/ui/InfoTooltip';

interface ChartInfoTooltipProps {
  title: string;
  description: string;
  items?: { color: string; label: string; description?: string }[];
  children?: ReactNode;
}

/** Info icon on a results chart or tile; the card stays inside the window, above the icon when there is no room below. */
const ChartInfoTooltip = ({ title, description, items, children }: ChartInfoTooltipProps) => {
  const body = (
    <div className="space-y-3">
      <div className="whitespace-pre-line">{description}</div>

      {items && items.length > 0 && (
        <div className="space-y-2">
          {items.map((item, i) => (
            <div key={i} className="flex items-start gap-2">
              <span className="w-2 h-2 rounded-full flex-shrink-0 mt-1" style={{ backgroundColor: item.color }} />
              <div>
                <span className="font-medium text-gray-700 dark:text-gray-300">{item.label}</span>
                {item.description && (
                  <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-0.5">{item.description}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {children}
    </div>
  );

  return (
    <span className="inline-flex ml-1 normal-case">
      <TextInfoIcon title={title} description={body} position="bottom" />
    </span>
  );
};

export default ChartInfoTooltip;
