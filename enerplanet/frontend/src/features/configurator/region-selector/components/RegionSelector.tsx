import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { ChevronDown, MapPin, Search, Check, Star, ArrowUpDown, Clock, Heart } from 'lucide-react';
import { Tooltip, TooltipTrigger, TooltipContent } from '@spatialhub/ui';
import { useDefaultRegionStore } from '../store/default-region';
import { useTranslation } from '@spatialhub/i18n';

export interface AvailableRegion {
    name: string;
    gridCount: number;
    country?: string;
    countryCode?: string;
    stateCode?: string;
    has3d?: boolean;
    bbox?: { west: number; south: number; east: number; north: number };
}

interface RegionSelectorProps {
    regions: AvailableRegion[];
    onRegionSelect: (region: AvailableRegion) => void;
}

// ── Country flag mapping ──
const COUNTRY_FLAGS: Record<string, string> = {
    DE: '🇩🇪', NL: '🇳🇱', FR: '🇫🇷', ES: '🇪🇸',
    IT: '🇮🇹', PT: '🇵🇹', AT: '🇦🇹', BE: '🇧🇪',
    CH: '🇨🇭', PL: '🇵🇱', CZ: '🇨🇿', DK: '🇩🇰',
    SE: '🇸🇪', NO: '🇳🇴', FI: '🇫🇮', IE: '🇮🇪',
    GB: '🇬🇧', GR: '🇬🇷', HU: '🇭🇺', RO: '🇷🇴',
    BG: '🇧🇬', HR: '🇭🇷', SK: '🇸🇰', SI: '🇸🇮',
    LT: '🇱🇹', LV: '🇱🇻', EE: '🇪🇪', LU: '🇱🇺',
    MT: '🇲🇹', CY: '🇨🇾',
};

// ── Total states/regions per country (for "X/Y states" display) ──
const TOTAL_STATES_PER_COUNTRY: Record<string, number> = {
    DE: 16, AT: 9, CZ: 21, NL: 12, FR: 18, ES: 19,
    IT: 20, PT: 18, BE: 11, CH: 26, PL: 16, DK: 5,
    SE: 21, NO: 11, FI: 19, IE: 4, GB: 4, GR: 13,
    HU: 20, RO: 42, BG: 28, HR: 21, SK: 8, SI: 12,
    LT: 10, LV: 5, EE: 15, LU: 1, MT: 1, CY: 1,
};

function getTotalStates(regions: AvailableRegion[], country: string): number | undefined {
    const region = regions.find(r => r.country === country && r.countryCode);
    if (region?.countryCode) return TOTAL_STATES_PER_COUNTRY[region.countryCode.toUpperCase()];
    return undefined;
}

function getFlag(regions: AvailableRegion[], country: string): string {
    const region = regions.find(r => r.country === country && r.countryCode);
    if (region?.countryCode) return COUNTRY_FLAGS[region.countryCode.toUpperCase()] || '🏳️';
    return '🏳️';
}

function formatNumber(n: number): string {
    return n.toLocaleString();
}

type SortMode = 'name' | 'grids';

// ── Recently used (localStorage, max 5) ──
const RECENT_KEY = 'region-selector-recent';
const MAX_RECENT = 5;

function normalizeRegionToken(value: string | undefined): string {
    return String(value || '').trim().toLowerCase();
}

function getRegionKey(region: AvailableRegion): string {
    const cc = normalizeRegionToken(region.countryCode);
    const sc = normalizeRegionToken(region.stateCode);
    const name = normalizeRegionToken(region.name);
    return `${cc}::${sc || name}`;
}

function getRecentRegions(): string[] {
    try {
        const raw = localStorage.getItem(RECENT_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

function addRecentRegion(region: AvailableRegion): void {
    const key = getRegionKey(region);
    const recent = getRecentRegions().filter(n => n !== key);
    recent.unshift(key);
    localStorage.setItem(RECENT_KEY, JSON.stringify(recent.slice(0, MAX_RECENT)));
}

export const RegionSelector: React.FC<RegionSelectorProps> = ({
    regions,
    onRegionSelect,
}) => {
    const { t } = useTranslation();
    const [isOpen, setIsOpen] = useState(false);
    const [searchQuery, setSearchQuery] = useState('');
    const [selectedRegion, setSelectedRegion] = useState<AvailableRegion | null>(null);
    const [sortMode, setSortMode] = useState<SortMode>('name');
    const [highlightIndex, setHighlightIndex] = useState(-1);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const { defaultRegion, setDefaultRegion, syncFromBackend } = useDefaultRegionStore();
    const hasAutoSelected = useRef(false);

    useEffect(() => { syncFromBackend(); }, [syncFromBackend]);

    // Auto-select default region when regions become available
    useEffect(() => {
        if (hasAutoSelected.current || !defaultRegion || regions.length === 0) return;
        const defaultKey = getRegionKey(defaultRegion);
        const match = regions.find(r => getRegionKey(r) === defaultKey)
            ?? regions.find(r =>
                normalizeRegionToken(r.name) === normalizeRegionToken(defaultRegion.name) &&
                (!defaultRegion.countryCode || normalizeRegionToken(r.countryCode) === normalizeRegionToken(defaultRegion.countryCode))
            );
        if (match) {
            hasAutoSelected.current = true;
            setSelectedRegion(match);
            onRegionSelect(match);
        }
    }, [defaultRegion, regions, onRegionSelect]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        if (isOpen) document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen]);

    useEffect(() => {
        if (isOpen) {
            setSearchQuery('');
            setHighlightIndex(-1);
            setTimeout(() => searchInputRef.current?.focus(), 100);
        }
    }, [isOpen]);

    // ── Favorites ──
    const favoriteRegions = useMemo(() => {
        if (!defaultRegion) return [];
        return regions.filter(r => r.name === defaultRegion.name);
    }, [regions, defaultRegion]);

    // ── Recently used ──
    const recentRegions = useMemo(() => {
        const recentKeys = getRecentRegions();
        return recentKeys
            .map((key) => regions.find(r => getRegionKey(r) === key) || regions.find(r => r.name === key))
            .filter((r): r is AvailableRegion =>
                r !== undefined && !favoriteRegions.some(f => getRegionKey(f) === getRegionKey(r))
            );
    }, [regions, favoriteRegions]);

    // ── Sorting ──
    const sortRegions = useCallback((regs: AvailableRegion[]) => {
        return [...regs].sort((a, b) => {
            if (sortMode === 'grids') return b.gridCount - a.gridCount;
            return a.name.localeCompare(b.name);
        });
    }, [sortMode]);

    // ── Grouping & filtering ──
    const { filteredGrouped, totalFiltered, flatList } = useMemo(() => {
        const q = searchQuery.toLowerCase();
        const grouped = regions.reduce<Record<string, AvailableRegion[]>>((acc, r) => {
            const key = r.country || 'Other';
            (acc[key] ??= []).push(r);
            return acc;
        }, {});

        const filtered = Object.entries(grouped).reduce<Record<string, AvailableRegion[]>>((acc, [country, regs]) => {
            const match = regs.filter(r =>
                r.name.toLowerCase().includes(q) || country.toLowerCase().includes(q)
            );
            if (match.length > 0) acc[country] = sortRegions(match);
            return acc;
        }, {});

        const total = Object.values(filtered).reduce((sum, r) => sum + r.length, 0);

        // Build flat list for keyboard navigation
        const flat: AvailableRegion[] = [];
        // Add favorites first (if not searching)
        if (!q && favoriteRegions.length > 0) {
            flat.push(...favoriteRegions);
        }
        // Add recents (if not searching)
        if (!q && recentRegions.length > 0) {
            flat.push(...recentRegions);
        }
        // Add all grouped regions
        for (const [, regs] of Object.entries(filtered)) {
            flat.push(...regs);
        }

        return { filteredGrouped: filtered, totalFiltered: total, flatList: flat };
    }, [regions, searchQuery, sortRegions, favoriteRegions, recentRegions]);

    // ── Summary stats ──
    const summaryStats = useMemo(() => {
        const countries = new Set(regions.map(r => r.country || 'Other')).size;
        const totalGrids = regions.reduce((sum, r) => sum + r.gridCount, 0);
        return { countries, regions: regions.length, totalGrids };
    }, [regions]);

    const handleSelect = useCallback((region: AvailableRegion) => {
        setSelectedRegion(region);
        setIsOpen(false);
        addRecentRegion(region);
        onRegionSelect(region);
    }, [onRegionSelect]);

    const handleToggleDefault = useCallback((e: React.MouseEvent, region: AvailableRegion) => {
        e.stopPropagation();
        const isCurrentDefault = defaultRegion ? getRegionKey(defaultRegion) === getRegionKey(region) : false;
        setDefaultRegion(isCurrentDefault ? null : region);
    }, [defaultRegion, setDefaultRegion]);

    // ── Keyboard navigation ──
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.key === 'Escape') {
            setIsOpen(false);
            return;
        }
        if (e.key === 'ArrowDown') {
            e.preventDefault();
            setHighlightIndex(prev => Math.min(prev + 1, flatList.length - 1));
        } else if (e.key === 'ArrowUp') {
            e.preventDefault();
            setHighlightIndex(prev => Math.max(prev - 1, 0));
        } else if (e.key === 'Enter' && highlightIndex >= 0 && highlightIndex < flatList.length) {
            e.preventDefault();
            handleSelect(flatList[highlightIndex]);
        }
    }, [flatList, highlightIndex, handleSelect]);

    // Scroll highlighted item into view
    useEffect(() => {
        if (highlightIndex < 0 || !listRef.current) return;
        const items = listRef.current.querySelectorAll('[data-region-item]');
        items[highlightIndex]?.scrollIntoView({ block: 'nearest' });
    }, [highlightIndex]);

    if (regions.length === 0) return null;

    const renderRegionItem = (region: AvailableRegion, flatIdx: number) => {
        const regionKey = getRegionKey(region);
        const isSelected = selectedRegion ? getRegionKey(selectedRegion) === regionKey : false;
        const isDefault = defaultRegion ? getRegionKey(defaultRegion) === regionKey : false;
        const isHighlighted = highlightIndex === flatIdx;

        return (
            <button
                key={regionKey}
                data-region-item
                onClick={() => handleSelect(region)}
                onMouseEnter={() => setHighlightIndex(flatIdx)}
                className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md transition-all duration-150 text-left text-sm hover:bg-muted text-foreground ${isSelected ? 'bg-muted' : ''} ${isHighlighted ? 'ring-1 ring-ring bg-muted/60' : ''}`}
            >
                <MapPin className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                <div className="flex-1 min-w-0 flex items-center gap-1.5">
                    <span className={`truncate ${isSelected ? 'font-semibold' : 'font-medium'}`}>
                        {region.name}
                    </span>
                    {region.has3d && (
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <span className="flex-shrink-0 px-1 py-0.5 text-[8px] font-bold leading-none rounded bg-slate-500/15 text-slate-500 dark:text-slate-400 border border-slate-500/25">
                                    3D
                                </span>
                            </TooltipTrigger>
                            <TooltipContent>{t('regionSelector.3dBuildingData', 'LiDAR 3D building heights available')}</TooltipContent>
                        </Tooltip>
                    )}
                </div>
                <span className="text-[10px] text-muted-foreground flex-shrink-0 tabular-nums">
                    {formatNumber(region.gridCount)} {t('map.grids', 'grids')}
                </span>
                {isSelected && (
                    <Check className="w-3.5 h-3.5 text-foreground flex-shrink-0" />
                )}
                <Tooltip>
                    <TooltipTrigger asChild>
                        <span
                            role="button"
                            tabIndex={0}
                            onClick={(e) => handleToggleDefault(e, region)}
                            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleToggleDefault(e as unknown as React.MouseEvent, region); } }}
                            className="flex-shrink-0 p-0.5 rounded hover:bg-accent transition-colors"
                        >
                            <Star
                                className={`w-3.5 h-3.5 transition-colors ${isDefault ? 'fill-yellow-400 text-yellow-400' : 'text-muted-foreground/40 hover:text-muted-foreground'}`}
                            />
                        </span>
                    </TooltipTrigger>
                    <TooltipContent>
                        {isDefault ? t('regionSelector.removeAsDefault', 'Remove as default region') : t('regionSelector.setAsDefault', 'Set as default region')}
                    </TooltipContent>
                </Tooltip>
            </button>
        );
    };

    // Track flat index across sections for keyboard navigation
    let flatIdx = 0;

    return (
        <div className="relative" ref={dropdownRef}>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        onClick={() => setIsOpen(!isOpen)}
                        className="group flex items-center gap-2 px-3 py-2 bg-card border border-border rounded-lg hover:border-muted-foreground/50 hover:shadow-sm transition-all duration-200"
                    >
                        <div className="flex items-center justify-center w-6 h-6 bg-muted rounded">
                            <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                        <span className="font-normal text-foreground max-w-[120px] truncate text-sm">
                            {selectedRegion?.name || t('regionSelector.goToRegion', 'Go to region')}
                        </span>
                        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                </TooltipTrigger>
                <TooltipContent>{t('regionSelector.jumpToRegion', 'Jump to a region with available grid data')}</TooltipContent>
            </Tooltip>

            {isOpen && (
                <div className="absolute top-full left-0 mt-1.5 w-72 bg-card border border-border rounded-lg shadow-lg z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 flex flex-col">
                    {/* Search + sort */}
                    <div className="p-2 border-b border-border">
                        <div className="relative flex gap-1.5">
                            <div className="relative flex-1">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
                                <input
                                    ref={searchInputRef}
                                    type="text"
                                    placeholder={t('regionSelector.searchPlaceholder', 'Search regions...')}
                                    value={searchQuery}
                                    onChange={(e) => { setSearchQuery(e.target.value); setHighlightIndex(-1); }}
                                    onKeyDown={handleKeyDown}
                                    className="w-full pl-8 pr-3 py-2 text-sm bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring placeholder-muted-foreground text-foreground"
                                />
                            </div>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <button
                                        onClick={() => setSortMode(prev => prev === 'name' ? 'grids' : 'name')}
                                        className="p-2 rounded-md bg-muted border border-border hover:bg-accent transition-colors flex-shrink-0"
                                    >
                                        <ArrowUpDown className="w-3.5 h-3.5 text-muted-foreground" />
                                    </button>
                                </TooltipTrigger>
                                <TooltipContent>{t(sortMode === 'name' ? 'regionSelector.sortByGridCount' : 'regionSelector.sortByName', sortMode === 'name' ? 'Sort by grid count' : 'Sort by name')}</TooltipContent>
                            </Tooltip>
                        </div>
                    </div>

                    {/* Region list */}
                    <div ref={listRef} className="max-h-64 overflow-y-auto p-1.5">
                        {/* ⭐ Favorites section */}
                        {!searchQuery && favoriteRegions.length > 0 && (
                            <div>
                                <div className="px-2.5 pt-1.5 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                                    <Heart className="w-3 h-3 fill-yellow-400 text-yellow-400" />
                                    {t('regionSelector.favorite', 'Favorite')}
                                </div>
                                <div className="space-y-0.5">
                                    {favoriteRegions.map((region) => {
                                        const item = renderRegionItem(region, flatIdx);
                                        flatIdx++;
                                        return item;
                                    })}
                                </div>
                            </div>
                        )}

                        {/* 🕐 Recently used section */}
                        {!searchQuery && recentRegions.length > 0 && (
                            <div>
                                <div className="px-2.5 pt-2 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center gap-1">
                                    <Clock className="w-3 h-3" />
                                    {t('regionSelector.recent', 'Recent')}
                                </div>
                                <div className="space-y-0.5">
                                    {recentRegions.map((region) => {
                                        const item = renderRegionItem(region, flatIdx);
                                        flatIdx++;
                                        return item;
                                    })}
                                </div>
                            </div>
                        )}

                        {/* Separator between pinned sections and country groups */}
                        {!searchQuery && (favoriteRegions.length > 0 || recentRegions.length > 0) && totalFiltered > 0 && (
                            <div className="mx-2 my-1.5 border-t border-border" />
                        )}

                        {totalFiltered === 0 ? (
                            <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                                {t('regionSelector.noRegionsFound', 'No regions found')}
                            </div>
                        ) : (
                            Object.entries(filteredGrouped).map(([country, regs]) => (
                                <div key={country}>
                                    <div className="px-2.5 pt-2 pb-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider flex items-center justify-between">
                                        <span>{getFlag(regs, country)} {country}</span>
                                        {(() => {
                                            const total = getTotalStates(regs, country);
                                            return total ? (
                                                <span className="text-[9px] font-semibold normal-case tracking-normal text-muted-foreground">
                                                    {regs.length}/{total}
                                                </span>
                                            ) : null;
                                        })()}
                                    </div>
                                    <div className="space-y-0.5">
                                        {regs.map((region) => {
                                            const item = renderRegionItem(region, flatIdx);
                                            flatIdx++;
                                            return item;
                                        })}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>

                    {/* 📊 Summary footer */}
                    <div className="px-3 py-1.5 border-t border-border bg-muted/50 text-[10px] text-muted-foreground text-center tabular-nums">
                        {summaryStats.countries} {t('map.countries', 'countries')} · {summaryStats.regions} {t('map.regions', 'regions')} · {formatNumber(summaryStats.totalGrids)} {t('map.grids', 'grids')}
                    </div>
                </div>
            )}
        </div>
    );
};
