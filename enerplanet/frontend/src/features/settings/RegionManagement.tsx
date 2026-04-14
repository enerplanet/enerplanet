import { useState, useEffect, useCallback, useMemo, type FC } from 'react';
import { pylovoService, type CachedRegion } from '@/features/configurator/services/pylovoService';
import { Loader2, Trash2, MapPin, AlertTriangle, RefreshCw, ChevronRight, ChevronDown, Search } from 'lucide-react';
import { Button } from '@spatialhub/ui';
import { InfoIcon } from '@/components/ui/InfoTooltip';

interface GroupedRegions {
    country: string;
    countryCode: string;
    regions: CachedRegion[];
    totalGrids: number;
}

const countryFlags: Record<string, string> = {
    DE: '\u{1F1E9}\u{1F1EA}', NL: '\u{1F1F3}\u{1F1F1}', FR: '\u{1F1EB}\u{1F1F7}', ES: '\u{1F1EA}\u{1F1F8}',
    IT: '\u{1F1EE}\u{1F1F9}', PT: '\u{1F1F5}\u{1F1F9}', AT: '\u{1F1E6}\u{1F1F9}', BE: '\u{1F1E7}\u{1F1EA}',
    CH: '\u{1F1E8}\u{1F1ED}', PL: '\u{1F1F5}\u{1F1F1}', CZ: '\u{1F1E8}\u{1F1FF}', DK: '\u{1F1E9}\u{1F1F0}',
    SE: '\u{1F1F8}\u{1F1EA}', NO: '\u{1F1F3}\u{1F1F4}', FI: '\u{1F1EB}\u{1F1EE}', IE: '\u{1F1EE}\u{1F1EA}',
    GB: '\u{1F1EC}\u{1F1E7}', GR: '\u{1F1EC}\u{1F1F7}', HU: '\u{1F1ED}\u{1F1FA}', RO: '\u{1F1F7}\u{1F1F4}',
    BG: '\u{1F1E7}\u{1F1EC}', HR: '\u{1F1ED}\u{1F1F7}', SK: '\u{1F1F8}\u{1F1F0}', SI: '\u{1F1F8}\u{1F1EE}',
    LT: '\u{1F1F1}\u{1F1F9}', LV: '\u{1F1F1}\u{1F1FB}', EE: '\u{1F1EA}\u{1F1EA}', LU: '\u{1F1F1}\u{1F1FA}',
    MT: '\u{1F1F2}\u{1F1F9}', CY: '\u{1F1E8}\u{1F1FE}',
};

function getFlag(code: string): string {
    return countryFlags[code.toUpperCase()] || '\u{1F3F3}\u{FE0F}';
}

const RegionManagement: FC = () => {
    const [regions, setRegions] = useState<CachedRegion[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [deletingId, setDeletingId] = useState<number | null>(null);
    const [togglingId, setTogglingId] = useState<number | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<CachedRegion | null>(null);
    const [expandedCountries, setExpandedCountries] = useState<Set<string>>(new Set());
    const [searchQuery, setSearchQuery] = useState('');

    const fetchRegions = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await pylovoService.getCachedRegions();
            setRegions(data);
        } catch {
            setError('Failed to load regions');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchRegions(); }, [fetchRegions]);

    const handleDelete = async (region: CachedRegion) => {
        setDeletingId(region.id);
        try {
            await pylovoService.deleteStateData(
                region.country_code.toLowerCase(),
                region.region_name.toLowerCase().replace(/\s+/g, '_'),
                false
            );
            await pylovoService.deleteCachedRegion(region.id);
            setRegions(prev => prev.filter(r => r.id !== region.id));
            setConfirmDelete(null);
        } catch {
            setError(`Failed to delete ${region.region_name}`);
        } finally {
            setDeletingId(null);
        }
    };

    const handleToggle = async (region: CachedRegion) => {
        setTogglingId(region.id);
        try {
            const newEnabled = !region.enabled;
            await pylovoService.toggleCachedRegion(region.id, newEnabled);
            setRegions(prev => prev.map(r => r.id === region.id ? { ...r, enabled: newEnabled } : r));
        } catch {
            setError(`Failed to toggle ${region.region_name}`);
        } finally {
            setTogglingId(null);
        }
    };

    const toggleCountry = (code: string) => {
        setExpandedCountries(prev => {
            const next = new Set(prev);
            if (next.has(code)) next.delete(code);
            else next.add(code);
            return next;
        });
    };

    const grouped: GroupedRegions[] = regions.reduce<GroupedRegions[]>((acc, region) => {
        const existing = acc.find(g => g.countryCode === region.country_code);
        if (existing) {
            existing.regions.push(region);
            existing.totalGrids += region.grid_count;
        } else {
            acc.push({
                country: region.country || region.country_code,
                countryCode: region.country_code,
                regions: [region],
                totalGrids: region.grid_count,
            });
        }
        return acc;
    }, []);

    const query = searchQuery.trim().toLowerCase();

    const filteredGroups = useMemo(() => {
        if (!query) return grouped;
        return grouped
            .map(group => {
                const countryMatch =
                    group.country.toLowerCase().includes(query) ||
                    group.countryCode.toLowerCase().includes(query);
                if (countryMatch) return group;
                const matchingRegions = group.regions.filter(r =>
                    r.region_name.toLowerCase().includes(query)
                );
                if (matchingRegions.length === 0) return null;
                return {
                    ...group,
                    regions: matchingRegions,
                    totalGrids: matchingRegions.reduce((s, r) => s + r.grid_count, 0),
                };
            })
            .filter((g): g is GroupedRegions => g !== null);
    }, [grouped, query]);

    // When searching, auto-expand countries that have matching regions
    const isExpanded = (code: string) => {
        if (query) return true;
        return expandedCountries.has(code);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-8">
                <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                <span className="ml-2 text-xs text-muted-foreground">Loading regions...</span>
            </div>
        );
    }

    if (error) {
        return (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
                <div className="flex items-center gap-2 text-xs text-destructive">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>{error}</span>
                </div>
                <Button variant="outline" size="sm" className="mt-2 h-7 text-xs" onClick={fetchRegions}>
                    <RefreshCw className="w-3 h-3 mr-1" /> Retry
                </Button>
            </div>
        );
    }

    if (grouped.length === 0) {
        return (
            <div className="text-center py-6 text-xs text-muted-foreground">
                <MapPin className="w-5 h-5 mx-auto mb-2 opacity-40" />
                No cached regions found
            </div>
        );
    }

    return (
        <div className="space-y-3">
            {/* Header: search + refresh + stats */}
            <div className="flex items-center gap-2">
                <div className="relative flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                    <input
                        type="text"
                        placeholder="Search regions..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        className="w-full h-7 pl-8 pr-2 text-xs rounded-md border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
                    />
                </div>
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0 flex-shrink-0" onClick={fetchRegions}>
                    <RefreshCw className="w-3.5 h-3.5" />
                </Button>
            </div>

            <span className="text-[10px] text-muted-foreground uppercase tracking-wider block">
                {grouped.length} {grouped.length === 1 ? 'country' : 'countries'} · {regions.length} region{regions.length !== 1 ? 's' : ''} · {regions.reduce((s, r) => s + r.grid_count, 0).toLocaleString()} grids
            </span>

            {/* Country accordion list */}
            <div className="rounded-lg border border-border overflow-hidden divide-y divide-border">
                {filteredGroups.map(group => {
                    const expanded = isExpanded(group.countryCode);
                    return (
                        <div key={group.countryCode}>
                            {/* Country row */}
                            <button
                                type="button"
                                onClick={() => toggleCountry(group.countryCode)}
                                className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/40 transition-colors"
                            >
                                {expanded
                                    ? <ChevronDown className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                                    : <ChevronRight className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0" />
                                }
                                <span className="text-sm leading-none">{getFlag(group.countryCode)}</span>
                                <span className="text-xs font-semibold text-foreground truncate">{group.country}</span>
                                <span className="text-[10px] px-1.5 py-0.5 bg-muted rounded text-muted-foreground font-medium flex-shrink-0">
                                    {group.countryCode}
                                </span>
                                <span className="ml-auto text-[10px] text-muted-foreground flex-shrink-0 flex items-center gap-3">
                                    <span>{group.regions.length} region{group.regions.length !== 1 ? 's' : ''}</span>
                                    <span>{group.totalGrids.toLocaleString()} grids</span>
                                </span>
                            </button>

                            {/* Region rows */}
                            {expanded && (
                                <div className="divide-y divide-border border-t border-border bg-muted/10">
                                    {group.regions.map(region => (
                                        <div
                                            key={region.id}
                                            className={`flex items-center justify-between pl-9 pr-3 py-2 transition-colors ${
                                                region.enabled ? 'hover:bg-muted/20' : 'opacity-60'
                                            }`}
                                        >
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <MapPin className={`w-3 h-3 flex-shrink-0 ${region.enabled ? 'text-muted-foreground' : 'text-muted-foreground/40'}`} />
                                                    <span className={`text-xs font-medium truncate ${region.enabled ? 'text-foreground' : 'text-muted-foreground line-through'}`}>
                                                        {region.region_name}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-3 mt-0.5 ml-5">
                                                    <span className="text-[10px] text-muted-foreground">
                                                        {region.grid_count.toLocaleString()} grids
                                                    </span>
                                                    <span className="text-[10px] text-muted-foreground flex items-center gap-1">
                                                        Level {region.admin_level}
                                                        <InfoIcon tooltipKey="adminLevel" position="top" />
                                                    </span>
                                                    {!region.enabled && (
                                                        <span className="text-[10px] text-amber-500 font-medium">Disabled</span>
                                                    )}
                                                </div>
                                            </div>

                                            <div className="flex items-center gap-2">
                                                <button
                                                    type="button"
                                                    role="switch"
                                                    aria-checked={region.enabled}
                                                    disabled={togglingId === region.id}
                                                    onClick={() => handleToggle(region)}
                                                    className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
                                                        region.enabled ? 'bg-primary' : 'bg-muted-foreground/30'
                                                    } ${togglingId === region.id ? 'opacity-50 cursor-wait' : 'cursor-pointer'}`}
                                                >
                                                    <span
                                                        className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform ${
                                                            region.enabled ? 'translate-x-[18px]' : 'translate-x-[3px]'
                                                        }`}
                                                    />
                                                </button>

                                                {confirmDelete?.id === region.id ? (
                                                    <div className="flex items-center gap-1.5">
                                                        <Button
                                                            variant="destructive"
                                                            size="sm"
                                                            className="h-6 px-2 text-[10px]"
                                                            disabled={deletingId === region.id}
                                                            onClick={() => handleDelete(region)}
                                                        >
                                                            {deletingId === region.id ? (
                                                                <Loader2 className="w-3 h-3 animate-spin" />
                                                            ) : (
                                                                'Confirm'
                                                            )}
                                                        </Button>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-6 px-2 text-[10px]"
                                                            onClick={() => setConfirmDelete(null)}
                                                        >
                                                            Cancel
                                                        </Button>
                                                    </div>
                                                ) : (
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                                        onClick={() => setConfirmDelete(region)}
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </Button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            {query && filteredGroups.length === 0 && (
                <div className="text-center py-4 text-xs text-muted-foreground">
                    No regions matching "{searchQuery}"
                </div>
            )}
        </div>
    );
};

export default RegionManagement;
