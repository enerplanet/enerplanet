/**
 * MapLegend - Compact map legend
 */

import React, { useState } from 'react';
import { ChevronDown, ChevronUp, Layers } from 'lucide-react';

interface LegendItem {
    label: string;
    type: 'line' | 'fill' | 'point' | 'dashed';
    color: string;
}

interface MapLegendProps {
    className?: string;
}

const legendItems: LegendItem[] = [
    { label: 'Grid Region', type: 'dashed', color: 'rgba(67, 56, 202, 0.85)' },
    { label: 'Selected Region', type: 'dashed', color: 'rgba(217, 119, 6, 0.9)' },
    { label: 'Building', type: 'fill', color: '#4f46e5' },
    { label: 'Transformer', type: 'point', color: '#d97706' },
    { label: 'LV Cable', type: 'line', color: '#059669' },
    { label: 'MV Line', type: 'line', color: '#ea580c' },
];

export const MapLegend: React.FC<MapLegendProps> = ({
    className = ''
}) => {
    const [isExpanded, setIsExpanded] = useState(true);

    const renderSymbol = (item: LegendItem) => {
        switch (item.type) {
            case 'dashed':
                return (
                    <svg className="w-6 h-3" viewBox="0 0 24 12">
                        <line x1="1" y1="6" x2="23" y2="6" stroke={item.color}
                            strokeWidth="2" strokeDasharray="5 3" strokeLinecap="round" />
                    </svg>
                );
            case 'line':
                return (
                    <svg className="w-6 h-3" viewBox="0 0 24 12">
                        <line x1="1" y1="6" x2="23" y2="6" stroke={item.color}
                            strokeWidth="2" strokeLinecap="round" />
                    </svg>
                );
            case 'fill':
                return (
                    <div className="w-3.5 h-3.5 rounded-sm" style={{ backgroundColor: item.color }} />
                );
            case 'point':
                return (
                    <div className="w-3 h-3 rounded-full border border-white shadow-sm"
                        style={{ backgroundColor: item.color }} />
                );
            default:
                return null;
        }
    };

    return (
        <div
            className={`
                absolute bottom-14 left-3 z-20
                bg-white/80 backdrop-blur-lg rounded-lg shadow-lg
                border border-black/[0.06]
                transition-all duration-200
                ${className}
            `}
            style={{ width: '164px' }}
        >
            {/* Header */}
            <button
                onClick={() => setIsExpanded(!isExpanded)}
                className="w-full flex items-center justify-between px-2.5 py-2 hover:bg-black/[0.03] rounded-lg transition-colors"
            >
                <div className="flex items-center gap-1.5">
                    <Layers className="w-3 h-3 text-gray-400" />
                    <span className="font-medium text-[10px] text-gray-500 uppercase tracking-wider">Legend</span>
                </div>
                {isExpanded
                    ? <ChevronDown className="w-3 h-3 text-gray-300" />
                    : <ChevronUp className="w-3 h-3 text-gray-300" />
                }
            </button>

            {isExpanded && (
                <div className="px-2.5 pb-2.5">
                    <div className="space-y-2">
                        {legendItems.map((item, idx) => (
                            <div key={idx} className="flex items-center gap-2">
                                <div className="flex-shrink-0 w-6 flex justify-center">
                                    {renderSymbol(item)}
                                </div>
                                <span className="text-[11px] text-gray-600 leading-none">{item.label}</span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
