import React, { useState, useEffect, useRef, useCallback } from 'react';
import { ChevronDown, Plus, Users, Check, Building2, Folder, Star } from 'lucide-react';
import { Workspace, workspaceService } from '@/components/workspace/services/workspaceService';
import { ensureDefaultWorkspace } from '@/components/workspace/utils/workspaceUtils';
import { Tooltip, TooltipTrigger, TooltipContent } from '@spatialhub/ui';
import { formatGroupName } from '@/components/workspace/utils/groupUtils';
import { useAuthStore } from '@/store/auth-store';
import { useTranslation } from '@spatialhub/i18n';

interface WorkspaceSelectorProps {
    onWorkspaceChange?: (workspace: Workspace | null) => void;
    onCreateWorkspace?: () => void;
    reloadKey?: number;
    initialWorkspaceId?: number;
    activeWorkspace?: Workspace | null;
}

export const WorkspaceSelector: React.FC<WorkspaceSelectorProps> = ({
    onWorkspaceChange,
    onCreateWorkspace,
    reloadKey,
    initialWorkspaceId,
    activeWorkspace,
}) => {
    const { t } = useTranslation();
    const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
    const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null);
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [isInitialLoad, setIsInitialLoad] = useState(true);
    const [searchQuery, setSearchQuery] = useState('');
    const dropdownRef = useRef<HTMLDivElement>(null);
    const searchInputRef = useRef<HTMLInputElement>(null);
    const user = useAuthStore(state => state.user);

    const onWorkspaceChangeRef = useRef(onWorkspaceChange);
    useEffect(() => {
        onWorkspaceChangeRef.current = onWorkspaceChange;
    }, [onWorkspaceChange]);

    const loadWorkspaces = useCallback(async () => {
        try {
            if (isInitialLoad) {
                setIsLoading(true);
            }

            let workspaceList = await workspaceService.getUserWorkspaces();

            workspaceList = await ensureDefaultWorkspace(workspaceList);

            const defaultWorkspace = workspaceList.find(w => w.is_default) || null;
            setWorkspaces(workspaceList);

            let initialWorkspace: Workspace | null = null;

            // Check if current workspace still exists
            if (activeWorkspace) {
                const foundWorkspace = workspaceList.find(w => w.id === activeWorkspace.id);
                if (foundWorkspace) {
                    initialWorkspace = foundWorkspace;
                } else {
                    // Current workspace was deleted, switch to default
                    initialWorkspace = defaultWorkspace || workspaceList[0] || null;
                }
            }
            if (!initialWorkspace && initialWorkspaceId) {
                initialWorkspace = workspaceList.find(w => w.id === initialWorkspaceId) || null;
            }
            initialWorkspace ??= defaultWorkspace || workspaceList[0] || null;

            setSelectedWorkspace(initialWorkspace);

            // Only propagate if workspace ID actually changed
            const activeWorkspaceId = activeWorkspace?.id ?? null;
            const initialWorkspaceIdToSet = initialWorkspace?.id ?? null;
            if (isInitialLoad || activeWorkspace == null || activeWorkspaceId !== initialWorkspaceIdToSet) {
                onWorkspaceChangeRef.current?.(initialWorkspace);
            }
        } catch (error) {
            if (import.meta.env.DEV) console.error('Failed to load workspaces:', error);
        } finally {
            if (isInitialLoad) {
                setIsLoading(false);
                setIsInitialLoad(false);
            }
        }
    }, [isInitialLoad, activeWorkspace, initialWorkspaceId]);

    useEffect(() => {
        loadWorkspaces();
    }, [reloadKey, loadWorkspaces]);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };

        if (isOpen) {
            document.addEventListener('mousedown', handleClickOutside);
        }

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [isOpen]);

    // Track the last processed workspace ID to prevent infinite loops
    const lastActiveWorkspaceIdRef = useRef<number | null>(null);

    useEffect(() => {
        if (activeWorkspace === undefined) {
            return;
        }

        // Prevent infinite loop by checking if we've already processed this workspace
        const currentId = activeWorkspace?.id ?? null;
        if (lastActiveWorkspaceIdRef.current === currentId) {
            return;
        }
        lastActiveWorkspaceIdRef.current = currentId;

        if (activeWorkspace) {
            setSelectedWorkspace((prev) => (prev?.id === activeWorkspace.id ? prev : activeWorkspace));
            setWorkspaces((prev) => {
                const filtered = prev.filter((w) => w.id !== activeWorkspace.id);

                if (activeWorkspace.is_default) {
                    return [activeWorkspace, ...filtered];
                }

                const defaultWorkspace = filtered.find((w) => w.is_default);

                if (!defaultWorkspace) {
                    return [activeWorkspace, ...filtered];
                }

                const others = filtered.filter((w) => w.id !== defaultWorkspace.id);
                return [defaultWorkspace, activeWorkspace, ...others];
            });
        } else {
            setSelectedWorkspace(null);
        }
    }, [activeWorkspace]);

    const handleWorkspaceSelect = (workspace: Workspace) => {
        setSelectedWorkspace(workspace);
        setIsOpen(false);
        onWorkspaceChange?.(workspace);
    };

    const handleCreateClick = () => {
        setIsOpen(false);
        onCreateWorkspace?.();
    };

    const getWorkspaceDisplayName = (workspace: Workspace | null | undefined) => {
        if (!workspace) {
            return t('workspace.selectWorkspace');
        }
        return workspace.is_default ? t('workspace.defaultWorkspace') : workspace.name;
    };

    useEffect(() => {
        if (isOpen) {
            loadWorkspaces();
            setSearchQuery('');
            setTimeout(() => searchInputRef.current?.focus(), 100);
        }
    }, [isOpen, loadWorkspaces]);

    const filteredWorkspaces = workspaces.filter(workspace => {
        if (!searchQuery.trim()) return true;
        const name = workspace.is_default ? t('workspace.defaultWorkspace') : workspace.name;
        return name.toLowerCase().includes(searchQuery.toLowerCase());
    });

    return (
        <div className="relative" ref={dropdownRef}>
            {/* Trigger button */}
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        onClick={() => setIsOpen(!isOpen)}
                        className="group flex items-center gap-2.5 px-3 py-2 bg-card border border-border rounded-lg hover:border-muted-foreground/50 hover:shadow-sm transition-all duration-200"
                        disabled={isLoading}
                    >
                        <div className="flex items-center justify-center w-6 h-6 bg-muted rounded">
                            <Folder className="w-3.5 h-3.5 text-muted-foreground" />
                        </div>
                        <span className="font-normal text-foreground max-w-[140px] truncate text-sm">
                            {isLoading ? t('common.loading') : getWorkspaceDisplayName(selectedWorkspace)}
                        </span>
                        <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                    </button>
                </TooltipTrigger>
                <TooltipContent>{t('workspace.selectWorkspace')}</TooltipContent>
            </Tooltip>

            {/* Dropdown */}
            {isOpen && (
                <div className="absolute top-full left-0 mt-1.5 w-72 bg-card border border-border rounded-lg shadow-lg z-50 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                    {/* Search input */}
                    <div className="p-2 border-b border-border">
                        <input
                            ref={searchInputRef}
                            type="text"
                            placeholder={t('workspace.searchWorkspaces')}
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="w-full px-3 py-2 text-sm bg-muted border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-ring placeholder-muted-foreground text-foreground"
                        />
                    </div>

                    {/* Workspace list */}
                    <div className="max-h-56 overflow-y-auto p-1.5">
                        {filteredWorkspaces.length === 0 ? (
                            <div className="px-3 py-4 text-sm text-muted-foreground text-center">
                                {searchQuery ? t('workspace.noWorkspacesMatch') : t('workspace.noWorkspacesFound')}
                            </div>
                        ) : (
                            <div className="space-y-0.5">
                                {filteredWorkspaces.map((workspace) => {
                                    const isSelected = selectedWorkspace?.id === workspace.id;
                                    const isOwner = String(workspace.user_id) === String(user?.id ?? "");
                                    const otherMembers = workspace.members?.filter((m) => {
                                        const sameId = String(m.user_id) === String(user?.id ?? "");
                                        const sameEmail = user?.email && m.email
                                            ? m.email.toLowerCase() === user.email.toLowerCase()
                                            : false;
                                        return !sameId && !sameEmail;
                                    }) ?? [];
                                    const groups = workspace.groups || [];

                                    return (
                                        <button
                                            key={workspace.id}
                                            onClick={() => handleWorkspaceSelect(workspace)}
                                            className={`w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md transition-all duration-150 text-left group text-sm hover:bg-muted text-foreground ${
                                                isSelected ? 'bg-muted' : ''
                                            }`}
                                        >
                                            {/* Workspace icon */}
                                            <div className="flex items-center justify-center w-6 h-6 rounded transition-colors bg-muted">
                                                {workspace.is_default ? (
                                                    <Star className="w-3.5 h-3.5 text-muted-foreground" />
                                                ) : (
                                                    <Folder className="w-3.5 h-3.5 text-muted-foreground" />
                                                )}
                                            </div>

                                            {/* Workspace info */}
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-1.5">
                                                    <span className={`text-sm truncate ${isSelected ? 'font-semibold' : 'font-medium'}`}>
                                                        {workspace.is_default ? t('workspace.defaultWorkspace') : workspace.name}
                                                    </span>
                                                    
                                                    {/* Inline tags */}
                                                    {workspace.is_default && (
                                                        <span className="text-[9px] px-1 py-0.5 rounded font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300">
                                                            {t('workspace.default')}
                                                        </span>
                                                    )}
                                                    {!isOwner && !workspace.is_default && (
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <span className="text-[9px] px-1 py-0.5 rounded font-medium flex items-center gap-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300">
                                                                    <Users className="w-2 h-2" />
                                                                    {t('workspace.shared')}
                                                                </span>
                                                            </TooltipTrigger>
                                                            <TooltipContent>
                                                                {t('workspace.sharedWithYouBy', { user: workspace.user_email || t('workspace.anotherUser') })}
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    )}
                                                    {isOwner && otherMembers.length > 0 && (
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <span className="text-[9px] px-1 py-0.5 rounded font-medium flex items-center gap-0.5 bg-purple-100 dark:bg-purple-900/30 text-purple-600 dark:text-purple-300">
                                                                    <Users className="w-2 h-2" />
                                                                    {otherMembers.length}
                                                                </span>
                                                            </TooltipTrigger>
                                                            <TooltipContent side="top" sideOffset={8} className="max-w-sm">
                                                                <div className="space-y-1">
                                                                    <p className="font-semibold text-xs mb-1">{t('workspace.sharedWithUsers')}:</p>
                                                                    {otherMembers.slice(0, 5).map((member) => (
                                                                        <div key={member.id} className="text-xs">
                                                                            {member.email || String(member.user_id)}
                                                                        </div>
                                                                    ))}
                                                                    {otherMembers.length > 5 && (
                                                                        <div className="text-xs text-gray-400 dark:text-gray-300">
                                                                            +{otherMembers.length - 5} {t('common.more')}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    )}
                                                    {isOwner && groups.length > 0 && (
                                                        <Tooltip>
                                                            <TooltipTrigger asChild>
                                                                <span className="text-[9px] px-1 py-0.5 rounded font-medium flex items-center gap-0.5 bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-300">
                                                                    <Building2 className="w-2 h-2" />
                                                                    {groups.length}
                                                                </span>
                                                            </TooltipTrigger>
                                                            <TooltipContent side="top" sideOffset={8} className="max-w-sm">
                                                                <div className="space-y-1">
                                                                    <p className="font-semibold text-xs mb-1">{t('workspace.sharedWithGroups')}:</p>
                                                                    {groups.slice(0, 5).map((group) => (
                                                                        <div key={group.id} className="text-xs">
                                                                            {formatGroupName(group.group_name)}
                                                                        </div>
                                                                    ))}
                                                                    {groups.length > 5 && (
                                                                        <div className="text-xs text-gray-400 dark:text-gray-300">
                                                                            +{groups.length - 5} {t('common.more')}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            </TooltipContent>
                                                        </Tooltip>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Check mark */}
                                            {isSelected && (
                                                <Check className="w-4 h-4 text-foreground flex-shrink-0" />
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                        )}
                    </div>

                    {/* Create new workspace button */}
                    <div className="p-2 border-t border-border">
                        <button
                            onClick={handleCreateClick}
                            className="w-full flex items-center gap-2 px-2.5 py-2 rounded-md hover:bg-accent transition-colors text-left group"
                        >
                            <div className="flex items-center justify-center w-6 h-6 bg-muted-foreground/20 rounded-md group-hover:bg-muted-foreground/30 transition-colors">
                                <Plus className="w-4 h-4 text-muted-foreground" />
                            </div>
                            <span className="text-sm font-medium text-foreground">
                                {t('workspace.createNewWorkspace')}
                            </span>
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

