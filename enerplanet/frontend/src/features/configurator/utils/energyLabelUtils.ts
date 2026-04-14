const ENERGY_LABEL_CLASS_MAP: Record<string, string> = {
    'A+++++': 'bg-emerald-700 text-white border-emerald-800',
    'A++++': 'bg-emerald-700 text-white border-emerald-800',
    'A+++': 'bg-emerald-600 text-white border-emerald-700',
    'A++': 'bg-emerald-500 text-white border-emerald-600',
    'A+': 'bg-lime-500 text-white border-lime-600',
    'A': 'bg-lime-400 text-black border-lime-500',
    'B': 'bg-lime-300 text-black border-lime-400',
    'C': 'bg-yellow-300 text-black border-yellow-400',
    'D': 'bg-amber-400 text-black border-amber-500',
    'E': 'bg-orange-400 text-white border-orange-500',
    'F': 'bg-red-500 text-white border-red-600',
    'G': 'bg-red-700 text-white border-red-800',
};

export const normalizeEnergyLabel = (value: unknown): string => {
    if (value === undefined || value === null) return '';
    return String(value).trim().toUpperCase().replace(/\s+/g, '');
};

export const getEnergyLabelColorClasses = (value: unknown): string => {
    const normalized = normalizeEnergyLabel(value);
    if (!normalized) return 'bg-muted text-muted-foreground border-border';
    return ENERGY_LABEL_CLASS_MAP[normalized] ?? 'bg-muted text-muted-foreground border-border';
};
