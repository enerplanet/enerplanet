import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Plus, Users, Check, Search } from 'lucide-react';
import { Group, groupService } from '@/components/workspace/services/groupService';
import { getGroupDisplayName, getGroupDisplayPath } from '@/components/workspace/utils/groupUtils';
import { useTranslation } from '@spatialhub/i18n';

interface GroupSelectorProps {
    onGroupChange?: (group: Group | null) => void;
    onCreateGroup?: () => void;
    reloadKey?: number;
    initialGroupId?: string;
    activeGroup?: Group | null;
    disabled?: boolean;
    accessLevel?: string;
}

export const GroupSelector: React.FC<GroupSelectorProps> = ({
    onGroupChange,
    onCreateGroup,
    reloadKey,
    initialGroupId,
    activeGroup,
    disabled = false,
    accessLevel,
}) => {
    const { t } = useTranslation();
    const [groups, setGroups] = useState<Group[]>([]);
    const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isInitialLoad, setIsInitialLoad] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);
    const dropdownMenuRef = useRef<HTMLDivElement>(null);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const [menuPosition, setMenuPosition] = useState<{ top?: number; bottom?: number; left: number; width: number; maxHeight?: number }>({ top: 0, left: 0, width: 280 });

    const updateMenuPosition = useCallback(() => {
        const triggerEl = buttonRef.current || dropdownRef.current;
        if (!triggerEl) return;
        const rect = triggerEl.getBoundingClientRect();
        const width = Math.max(280, rect.width);
        let left = rect.left;
        const maxLeft = Math.max(8, Math.min(left, window.innerWidth - 8 - width));
        left = maxLeft;

        const spaceBelow = window.innerHeight - rect.bottom - 8;
        const spaceAbove = rect.top - 8;
        const estimatedHeight = 320; // Reduced estimated height

        // Prefer placing below if there's enough space or if it's better than above
        if (spaceBelow >= 200 || spaceBelow >= spaceAbove) {
            setMenuPosition({
                top: rect.bottom + 4,
                left,
                width,
                maxHeight: Math.min(estimatedHeight, spaceBelow)
            });
        } else {
            // Place above
            setMenuPosition({
                bottom: window.innerHeight - rect.top + 4,
                left,
                width,
                maxHeight: Math.min(estimatedHeight, spaceAbove)
            });
        }
    }, []);

    // Focus search input when menu opens
    useEffect(() => {
        if (isOpen && searchInputRef.current) {
            setTimeout(() => searchInputRef.current?.focus(), 50);
        }
        if (!isOpen) {
            setSearchQuery('');
        }
    }, [isOpen]);

    const loadGroups = useCallback(async () => {
        try {
            if (isInitialLoad) {
                setIsLoading(true);
            }

            const groupList = await groupService.getGroups();
            setGroups(groupList);

            let initialGroup: Group | null = null;

            if (activeGroup) {
                initialGroup = groupList.find(g => g.id === activeGroup.id) || null;
            }
            if (!initialGroup && initialGroupId) {
                initialGroup = groupList.find(g => g.id === initialGroupId) || null;
            }

            if (!initialGroup && accessLevel === "manager" && groupList.length > 0) {
                initialGroup = groupList[0];
            }

            setSelectedGroup(initialGroup);

            if (isInitialLoad && onGroupChange) {
                onGroupChange(initialGroup);
            }
        } catch (error) {
            if (import.meta.env.DEV) console.error('Failed to load groups:', error);
        } finally {
            if (isInitialLoad) {
                setIsLoading(false);
                setIsInitialLoad(false);
            }
        }
    }, [isInitialLoad, activeGroup, initialGroupId, onGroupChange, accessLevel]);

    useEffect(() => {
        loadGroups();
    }, [reloadKey, loadGroups]);

    useEffect(() => {
        let ro: ResizeObserver | null = null;
        const handleClickOutside = (event: MouseEvent) => {
            const target = event.target as Node;
            const clickedInsideTrigger = !!dropdownRef.current && dropdownRef.current.contains(target);
            const clickedInsideMenu = !!dropdownMenuRef.current && dropdownMenuRef.current.contains(target);
            if (!clickedInsideTrigger && !clickedInsideMenu) {
                setIsOpen(false);
            }
        };

        const handleScrollResize = () => {
            if (isOpen) updateMenuPosition();
        };

        if (isOpen) {
            updateMenuPosition();
            document.addEventListener('mousedown', handleClickOutside);
            document.addEventListener('scroll', handleScrollResize, true);
            globalThis.addEventListener('scroll', handleScrollResize, true);
            globalThis.addEventListener('resize', handleScrollResize);
            if (typeof ResizeObserver !== 'undefined' && buttonRef.current) {
                ro = new ResizeObserver(() => updateMenuPosition());
                ro.observe(buttonRef.current);
            }
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('scroll', handleScrollResize, true);
            globalThis.removeEventListener('scroll', handleScrollResize, true);
            globalThis.removeEventListener('resize', handleScrollResize);
            if (ro) {
                ro.disconnect();
            }
        };
    }, [isOpen, updateMenuPosition]);

    useEffect(() => {
        if (activeGroup === undefined) {
            return;
        }

        if (activeGroup) {
            setSelectedGroup(activeGroup);
        } else {
            setSelectedGroup(null);
        }
    }, [activeGroup]);

    const handleGroupSelect = (group: Group | null) => {
        setSelectedGroup(group);
        setIsOpen(false);
        onGroupChange?.(group);
    };

    const handleCreateClick = () => {
        setIsOpen(false);
        onCreateGroup?.();
    };

    const getDisplayName = (group: Group | null | undefined) => {
        if (!group) {
            return accessLevel === "manager" ? t("userManagement.groups.noGroups") : t("userManagement.groups.allGroups");
        }
        return getGroupDisplayName(group);
    };

    // Filter groups by search query
    const filteredGroups = groups.filter(group => {
        if (!searchQuery.trim()) return true;
        const displayName = getGroupDisplayName(group).toLowerCase();
        const path = getGroupDisplayPath(group).toLowerCase();
        const query = searchQuery.toLowerCase();
        return displayName.includes(query) || path.includes(query);
    });

    const FONT_SEMIBOLD = 'font-semibold';
    const FONT_MEDIUM = 'font-medium';
    const HOVER_GROUP_CLASS = 'hover:bg-muted';
    const ACTIVE_GROUP_CLASS = 'bg-muted';
    const ICON_COLOR_CLASS = 'text-muted-foreground';
    const TEXT_COLOR_CLASS = 'text-foreground';

    return (
        <div className="relative" ref={dropdownRef}>
            <button
                type="button"
                ref={buttonRef}
                onClick={() => {
                    if (disabled) return;
                    setIsOpen((prev) => !prev);
                }}
                className={`flex items-center gap-2 h-9 px-3 border border-input rounded-lg ${HOVER_GROUP_CLASS} transition-all duration-200 bg-background text-sm disabled:opacity-50 disabled:cursor-not-allowed min-w-[160px] justify-between shadow-sm`}
                disabled={isLoading || disabled}
            >
                <div className="flex items-center gap-2 min-w-0">
                    <div className="w-6 h-6 rounded-md bg-muted flex items-center justify-center flex-shrink-0">
                        <Users className={`w-3.5 h-3.5 ${ICON_COLOR_CLASS}`} />
                    </div>
                    <span className={`${TEXT_COLOR_CLASS} truncate ${selectedGroup ? FONT_SEMIBOLD : FONT_MEDIUM}`}>
                        {isLoading ? t("userManagement.groups.loading") : getDisplayName(selectedGroup)}
                    </span>
                </div>
                <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && createPortal(
                <div
                    ref={dropdownMenuRef}
                    role="menu"
                    tabIndex={-1}
                    aria-label="Group selection menu"
                    className="fixed bg-card border border-border rounded-xl shadow-xl z-[9999] overflow-hidden pointer-events-auto"
                    style={{ 
                        top: menuPosition.top, 
                        bottom: menuPosition.bottom,
                        left: menuPosition.left, 
                        width: menuPosition.width,
                        maxHeight: menuPosition.maxHeight 
                    }}
                    onWheel={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                            setIsOpen(false);
                        }
                    }}
                >
                    <div className="flex flex-col max-h-[inherit]">
                        {/* Search input */}
                        <div className="p-2 border-b border-border flex-shrink-0">
                            <div className="relative">
                                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                                <input
                                    ref={searchInputRef}
                                    type="text"
                                    placeholder={t("userManagement.groups.searchGroups")}
                                    value={searchQuery}
                                    onChange={(e) => setSearchQuery(e.target.value)}
                                    className="w-full pl-8 pr-3 py-1.5 text-sm bg-muted border border-input rounded-lg focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent text-foreground placeholder-muted-foreground"
                                />
                            </div>
                        </div>

                        {onCreateGroup && (
                            <div className="p-2 border-b border-border flex-shrink-0">
                                <button
                                    type="button"
                                    onClick={handleCreateClick}
                                    className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md ${HOVER_GROUP_CLASS} transition-colors text-left group`}
                                >
                                    <div className="w-6 h-6 rounded-md bg-muted-foreground/20 flex items-center justify-center flex-shrink-0 group-hover:bg-muted-foreground/30 transition-colors">
                                        <Plus className="w-4 h-4 text-muted-foreground" />
                                    </div>
                                    <span className={`text-sm font-medium ${TEXT_COLOR_CLASS}`}>
                                        {t("userManagement.groups.createNewGroup")}
                                    </span>
                                </button>
                            </div>
                        )}

                        <div
                            className="overflow-y-auto py-1 min-h-0"
                            onWheel={(e) => e.stopPropagation()}
                        >
                        {accessLevel === "expert" && (
                            <>
                                <button
                                    type="button"
                                    onClick={() => handleGroupSelect(null)}
                                    className={`w-full flex items-center gap-3 px-3 py-2 ${HOVER_GROUP_CLASS} transition-colors text-left ${selectedGroup ? '' : ACTIVE_GROUP_CLASS}`}
                                >
                                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                                        <Users className={`w-4 h-4 ${ICON_COLOR_CLASS}`} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <span className={`text-sm ${TEXT_COLOR_CLASS} block truncate ${selectedGroup ? FONT_MEDIUM : FONT_SEMIBOLD}`}>
                                            {t("userManagement.groups.allGroups")}
                                        </span>
                                        <span className="text-xs text-muted-foreground block truncate">
                                            {t("userManagement.groups.viewUsersFromAllGroups")}
                                        </span>
                                    </div>
                                    {!selectedGroup && (
                                        <Check className="w-4 h-4 text-foreground flex-shrink-0" />
                                    )}
                                </button>
                                {filteredGroups.length > 0 && <div className="border-t border-border my-1" />}
                            </>
                        )}

                        {filteredGroups.length === 0 ? (
                            <div className="px-3 py-6 text-sm text-muted-foreground text-center">
                                {searchQuery ? t("userManagement.groups.noGroupsMatchSearch") : t("userManagement.groups.noGroupsFound")}
                            </div>
                        ) : (
                            filteredGroups.map((group) => (
                                <button
                                    type="button"
                                    key={group.id}
                                    onClick={() => handleGroupSelect(group)}
                                    className={`w-full flex items-center gap-3 px-3 py-2 ${HOVER_GROUP_CLASS} transition-colors text-left ${selectedGroup?.id === group.id ? ACTIVE_GROUP_CLASS : ''}`}
                                >
                                    <div className="w-8 h-8 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                                        <Users className={`w-4 h-4 ${ICON_COLOR_CLASS}`} />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <span className={`text-sm ${TEXT_COLOR_CLASS} block truncate ${selectedGroup?.id === group.id ? FONT_SEMIBOLD : FONT_MEDIUM}`}>
                                            {getGroupDisplayName(group)}
                                        </span>
                                        <span className="text-xs text-muted-foreground block truncate">
                                            {getGroupDisplayPath(group)}
                                        </span>
                                    </div>
                                    {selectedGroup?.id === group.id && (
                                        <Check className="w-4 h-4 text-foreground flex-shrink-0" />
                                    )}
                                </button>
                            ))
                        )}
                    </div>
                </div>
            </div>, document.body)
            }
        </div>
    );
};
