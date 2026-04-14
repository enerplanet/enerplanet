import { useState, useEffect, type FC } from 'react';
import { InfoIcon } from '@/components/ui/InfoTooltip';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@spatialhub/ui';
import type {
    AdvancedParameterOption,
    AdvancedParametersState,
    ParameterRangeInputProps,
    ParameterSelectInputProps,
    AdvancedParametersDrawerProps
} from '@/features/configurator/types/area-select';
import { ADVANCED_PARAMETERS } from '@/features/configurator/constants/area-select-params';


const ParameterNumberInput: FC<{
    parameter: import('@/features/configurator/types/area-select').AdvancedParameter;
    value: number;
    onChange: (value: number) => void;
}> = ({ parameter, value, onChange }) => {
    return (
        <div className="space-y-2">
            <label className="flex items-center text-sm font-medium text-foreground">
                {parameter.name}
                <div className="ml-2">
                    <InfoIcon tooltipKey={parameter.id as any} position="fixed-left-anchored" />
                </div>
            </label>
            <div className="flex items-center border border-border rounded-md bg-background dark:bg-gray-700">
                <input
                    type="number"
                    value={value}
                    onChange={(e) => onChange(Number(e.target.value))}
                    min={parameter.min}
                    max={parameter.max}
                    step={parameter.step}
                    className="flex-1 px-3 py-2 border-0 focus:ring-0 focus:outline-none bg-transparent text-sm text-foreground"
                />
            </div>
        </div>
    );
};

const ParameterRangeInput: FC<ParameterRangeInputProps> = ({
    parameter,
    value,
    onChange,
}) => {
    const handleMinChange = (newMin: number) => {
        const clampedMin = Math.max(parameter.min!, Math.min(value.max, newMin));
        onChange({ ...value, min: clampedMin });
    };

    const handleMaxChange = (newMax: number) => {
        const clampedMax = Math.min(parameter.max!, Math.max(value.min, newMax));
        onChange({ ...value, max: clampedMax });
    };

    const getTooltipKey = (paramId: string): import('@/components/shared/tooltip-contents').TooltipKey => {
        // Map new parameters to existing tooltip keys or use a default
        // You might need to update TooltipKey type in tooltip-contents.ts
        return paramId as any; 
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <label className="flex items-center text-sm font-medium text-foreground">
                    {parameter.name}
                    <div className="ml-2">
                        <InfoIcon tooltipKey={getTooltipKey(parameter.id)} position="fixed-left-anchored" />
                    </div>
                </label>
                <div className="text-xs text-muted-foreground">
                    {value.min} - {value.max}
                </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
                <div>
                    <label htmlFor={`${parameter.id}-min`} className="text-xs text-muted-foreground mb-1 block">Minimum</label>
                    <div className="flex items-center border border-border rounded-md bg-background dark:bg-gray-700">
                        <button
                            type="button"
                            onClick={() => handleMinChange(value.min - parameter.step!)}
                            className="px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors flex-shrink-0 text-sm"
                            style={{ minWidth: '24px', height: '28px' }}
                            aria-label="Decrease minimum value"
                        >
                            −
                        </button>
                        <input
                            id={`${parameter.id}-min`}
                            type="number"
                            value={value.min}
                            onChange={(e) => {
                                const newValue = Number.parseFloat(e.target.value);
                                if (!Number.isNaN(newValue)) {
                                    handleMinChange(newValue);
                                }
                            }}
                            min={parameter.min}
                            max={parameter.max}
                            step={parameter.step}
                            className="flex-1 text-center py-1 border-0 focus:ring-0 focus:outline-none bg-transparent text-xs text-foreground"
                            style={{ width: '40px', height: '28px' }}
                        />
                        <button
                            type="button"
                            onClick={() => handleMinChange(value.min + parameter.step!)}
                            className="px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors flex-shrink-0 text-sm"
                            style={{ minWidth: '24px', height: '28px' }}
                            aria-label="Increase minimum value"
                        >
                            +
                        </button>
                    </div>
                </div>

                <div>
                    <label htmlFor={`${parameter.id}-max`} className="text-xs text-muted-foreground mb-1 block">Maximum</label>
                    <div className="flex items-center border border-border rounded-md bg-background dark:bg-gray-700">
                        <button
                            type="button"
                            onClick={() => handleMaxChange(value.max - parameter.step!)}
                            className="px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors flex-shrink-0 text-sm"
                            style={{ minWidth: '24px', height: '28px' }}
                            aria-label="Decrease maximum value"
                        >
                            −
                        </button>
                        <input
                            id={`${parameter.id}-max`}
                            type="number"
                            value={value.max}
                            onChange={(e) => {
                                const newValue = Number.parseFloat(e.target.value);
                                if (!Number.isNaN(newValue)) {
                                    handleMaxChange(newValue);
                                }
                            }}
                            min={parameter.min}
                            max={parameter.max}
                            step={parameter.step}
                            className="flex-1 text-center py-1 border-0 focus:ring-0 focus:outline-none bg-transparent text-xs text-foreground"
                            style={{ width: '40px', height: '28px' }}
                        />
                        <button
                            type="button"
                            onClick={() => handleMaxChange(value.max + parameter.step!)}
                            className="px-1.5 py-1 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors flex-shrink-0 text-sm"
                            style={{ minWidth: '24px', height: '28px' }}
                            aria-label="Increase maximum value"
                        >
                            +
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

const ParameterSelectInput: FC<ParameterSelectInputProps> = ({
    parameter,
    value,
    onChange,
}) => {
    return (
        <div className="space-y-2">
            <label className="flex items-center text-sm font-medium text-foreground">
                {parameter.name}
                <div className="ml-2">
                    <InfoIcon tooltipKey={parameter.id as any} position="fixed-left-anchored" />
                </div>
            </label>
            <Select value={value} onValueChange={onChange}>
                <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select option" />
                </SelectTrigger>
                <SelectContent>
                    {parameter.options?.map((option: AdvancedParameterOption) => (
                        <SelectItem key={option.value} value={option.value}>
                            {option.label}
                        </SelectItem>
                    ))}
                </SelectContent>
            </Select>
        </div>
    );
};

export const AdvancedParametersDrawer: FC<AdvancedParametersDrawerProps> = ({
    isOpen,
    onClose,
    parameters,
    onParametersChange,
    onReset,
}) => {
    const [isAnimating, setIsAnimating] = useState(false);

    useEffect(() => {
        if (isOpen) {
            setTimeout(() => {
                setIsAnimating(true);
            }, 10);
        }
    }, [isOpen]);

    const handleClose = () => {
        setIsAnimating(false);
        setTimeout(() => {
            onClose();
        }, 300);
    };

    if (!isOpen) return null;

    const handleParameterChange = (id: string, value: number | string | { min: number; max: number }) => {
        onParametersChange({
            ...parameters,
            [id]: value,
        });
    };

    const hasNonDefaultValues = () => {
        return ADVANCED_PARAMETERS.some(param => {
            const currentValue = parameters[param.id as keyof AdvancedParametersState];
            const defaultValue = param.defaultValue;

            if (param.type === 'range') {
                const current = currentValue as unknown as { min: number; max: number };
                const defaultVal = defaultValue as { min: number; max: number };
                return current.min !== defaultVal.min || current.max !== defaultVal.max;
            } else {
                return currentValue !== defaultValue;
            }
        });
    };

    return (
        <>
            <div
                className={`absolute inset-0 bg-black/20 z-20 transition-opacity duration-300 ${
                    isAnimating ? "opacity-100" : "opacity-0 pointer-events-none"
                }`}
                onClick={handleClose}
                aria-hidden="true"
            />

            <div className={`absolute top-0 right-0 w-full h-full bg-background dark:bg-gray-800 shadow-xl z-30 border-l border-border transition-transform duration-300 ease-in-out ${
                isAnimating ? 'transform translate-x-0' : 'transform translate-x-full'
            }`}>
                <div className="px-3 pt-4 pb-3 border-b border-border">
                    <div className="flex items-center justify-between">
                        <h3 className="text-base font-semibold text-foreground">Advanced Parameters</h3>
                        <button
                            onClick={handleClose}
                            className="p-1.5 hover:bg-muted rounded-lg transition-colors text-foreground"
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                        Configure advanced parameters for your Energy assessment
                    </div>
                </div>

                <div className="px-3 py-4 space-y-6 h-[calc(100vh-180px)] overflow-y-auto">
                    {ADVANCED_PARAMETERS.map((parameter) => {
                        const paramValue = parameters[parameter.id as keyof AdvancedParametersState];
                        
                        if (parameter.type === 'range') {
                            return (
                                <div key={parameter.id} className="border-b border-border pb-4 last:border-b-0">
                                    <ParameterRangeInput
                                        parameter={parameter}
                                        value={paramValue as unknown as { min: number; max: number }}
                                        onChange={(value: { min: number; max: number }) => handleParameterChange(parameter.id, value)}
                                    />
                                </div>
                            );
                        }
                        
                        if (parameter.type === 'select') {
                            return (
                                <div key={parameter.id} className="border-b border-border pb-4 last:border-b-0">
                                    <ParameterSelectInput
                                        parameter={parameter}
                                        value={paramValue as string}
                                        onChange={(value: string) => handleParameterChange(parameter.id, value)}
                                    />
                                </div>
                            );
                        }

                        if (parameter.type === 'number') {
                            return (
                                <div key={parameter.id} className="border-b border-border pb-4 last:border-b-0">
                                    <ParameterNumberInput
                                        parameter={parameter}
                                        value={paramValue as number}
                                        onChange={(value: number) => handleParameterChange(parameter.id, value)}
                                    />
                                </div>
                            );
                        }
                        
                        return null;
                    })}
                </div>

                <div className="absolute bottom-0 left-0 right-0 px-3 py-3 border-t border-border bg-background dark:bg-gray-800">
                    <div className="flex space-x-2">
                        <button
                            onClick={onReset}
                            disabled={!hasNonDefaultValues()}
                            className="flex-1 px-3 py-2 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-red-600 text-white hover:bg-red-700 disabled:bg-gray-400"
                        >
                            Reset to Defaults
                        </button>
                        <button
                            onClick={handleClose}
                            className="flex-1 px-3 py-2 bg-gradient-to-br from-gray-800 to-black hover:from-gray-700 hover:to-gray-900 dark:from-gray-600 dark:to-gray-800 dark:hover:from-gray-500 dark:hover:to-gray-700 text-white rounded-lg text-sm font-medium transition-colors border-0"
                        >
                            Apply Changes
                        </button>
                    </div>
                </div>
            </div>
        </>
    );
};
