import { useState, type ReactNode } from 'react';
import { Info } from 'lucide-react';

interface ChartInfoTooltipProps {
  title: string;
  description: string;
  items?: { color: string; label: string; description?: string }[];
  children?: ReactNode;
}

const ChartInfoTooltip = ({ title, description, items, children }: ChartInfoTooltipProps) => {
  const [show, setShow] = useState(false);

  return (
    <div className="relative inline-block ml-1">
      <button
        type="button"
        onMouseEnter={() => setShow(true)}
        onMouseLeave={() => setShow(false)}
        onClick={() => setShow(!show)}
        className="cursor-pointer bg-transparent border-0 p-0 inline-flex"
        aria-label={title}
      >
        <Info className="w-4 h-4 text-gray-400 dark:text-gray-300 hover:text-gray-600 dark:hover:text-gray-200" />
      </button>

      {show && (
        <div className="absolute z-[100] top-full left-0 translate-y-2 w-72 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-2xl p-4">
          <div className="space-y-3">
            <div className="text-sm font-medium text-gray-900 dark:text-gray-100">{title}</div>
            <div className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">{description}</div>

            {items && items.length > 0 && (
              <div className="space-y-2 text-xs">
                {items.map((item, i) => (
                  <div key={i} className="flex items-start gap-2">
                    <span className={`w-2 h-2 rounded-full flex-shrink-0 mt-1`} style={{ backgroundColor: item.color }} />
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
        </div>
      )}
    </div>
  );
};

export default ChartInfoTooltip;
