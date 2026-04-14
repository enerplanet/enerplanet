import React, { useState, useEffect, useRef } from 'react';
import { Users, Building2, Trash2, UserPlus, Folder } from 'lucide-react';
import { IconX } from '@tabler/icons-react';
import { GroupSelector } from '@/components/group/GroupSelector';
import { WorkspaceSelector } from '@/components/workspace/WorkspaceSelector';
import type { Group } from '@/components/workspace/services/groupService';
import type { Workspace } from '@/components/workspace/services/workspaceService';
import { formatGroupName, getGroupDisplayName } from '@/components/workspace/utils/groupUtils';
import { useAuthStore } from '@/store/auth-store';
import { useTranslation } from '@spatialhub/i18n';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
} from '@spatialhub/ui';
import {
  customLocationService,
  type CustomLocation,
  type LocationSharesListResponse,
} from '@/features/locations/services/customLocationService';

interface LocationShareDialogProps {
  isOpen: boolean;
  location: CustomLocation | null;
  onClose: () => void;
  onUpdated?: () => void;
}

type ShareTab = 'users' | 'workspaces' | 'groups';

export const LocationShareDialog: React.FC<LocationShareDialogProps> = ({
  isOpen,
  location,
  onClose,
  onUpdated
}) => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<ShareTab>('users');
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [selectedWorkspace, setSelectedWorkspace] = useState<Workspace | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingShares, setIsLoadingShares] = useState(false);
  const [error, setError] = useState<string>('');
  const [shares, setShares] = useState<LocationSharesListResponse>({
    user_shares: [],
    workspace_shares: [],
    group_shares: [],
  });

  const [userFormData, setUserFormData] = useState({ email: '' });

  const wasOpenRef = useRef<boolean>(isOpen);

  useEffect(() => {
    if (wasOpenRef.current && !isOpen) {
      setUserFormData({ email: '' });
      setSelectedGroup(null);
      setSelectedWorkspace(null);
      setError('');
      setActiveTab('users');
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    if (isOpen && location?.id) {
      setIsLoadingShares(true);
      customLocationService.getLocationShares(location.id)
        .then(setShares)
        .catch((err) => {
          if (import.meta.env.DEV) console.error('Failed to load shares:', err);
        })
        .finally(() => setIsLoadingShares(false));
    }
  }, [isOpen, location?.id]);

  const handleAddUserShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!location?.id || !userFormData.email.trim()) return;

    setError('');
    setIsLoading(true);

    try {
      const inputEmail = userFormData.email.trim().toLowerCase();
      const isAlreadyShared = shares.user_shares.some(s => s.email?.toLowerCase() === inputEmail);

      if (isAlreadyShared) {
        setError(t('locations.share.alreadySharedWithUser'));
        setIsLoading(false);
        return;
      }

      const newShare = await customLocationService.shareWithUser(location.id, inputEmail);
      setShares(prev => ({
        ...prev,
        user_shares: [...prev.user_shares, newShare],
      }));
      setUserFormData({ email: '' });
      onUpdated?.();
    } catch (err: unknown) {
      if (import.meta.env.DEV) console.error('Failed to share with user:', err);
      const errorObj = err as { response?: { data?: { error?: string; message?: string } } };
      setError(errorObj.response?.data?.error || errorObj.response?.data?.message || t('locations.share.failedToShare'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveUserShare = async (shareId: number) => {
    if (!location?.id) return;

    try {
      await customLocationService.removeUserShare(location.id, shareId);
      setShares(prev => ({
        ...prev,
        user_shares: prev.user_shares.filter(s => s.id !== shareId),
      }));
      onUpdated?.();
    } catch (err) {
      if (import.meta.env.DEV) console.error('Failed to remove share:', err);
    }
  };

  const handleAddWorkspaceShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!location?.id || !selectedWorkspace) return;

    setError('');
    setIsLoading(true);

    try {
      const isAlreadyShared = shares.workspace_shares.some(s => s.workspace_id === selectedWorkspace.id);

      if (isAlreadyShared) {
        setError(t('locations.share.alreadySharedWithWorkspace'));
        setIsLoading(false);
        return;
      }

      const newShare = await customLocationService.shareWithWorkspace(location.id, selectedWorkspace.id);
      setShares(prev => ({
        ...prev,
        workspace_shares: [...prev.workspace_shares, { ...newShare, workspace_name: selectedWorkspace.name }],
      }));
      setSelectedWorkspace(null);
      onUpdated?.();
    } catch (err: unknown) {
      if (import.meta.env.DEV) console.error('Failed to share with workspace:', err);
      const errorObj = err as { response?: { data?: { error?: string; message?: string } } };
      setError(errorObj.response?.data?.error || errorObj.response?.data?.message || t('locations.share.failedToShare'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveWorkspaceShare = async (shareId: number) => {
    if (!location?.id) return;

    try {
      await customLocationService.removeWorkspaceShare(location.id, shareId);
      setShares(prev => ({
        ...prev,
        workspace_shares: prev.workspace_shares.filter(s => s.id !== shareId),
      }));
      onUpdated?.();
    } catch (err) {
      if (import.meta.env.DEV) console.error('Failed to remove workspace share:', err);
    }
  };

  const handleAddGroupShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!location?.id || !selectedGroup) return;

    setError('');
    setIsLoading(true);

    try {
      const isAlreadyShared = shares.group_shares.some(s => s.group_id === selectedGroup.id);

      if (isAlreadyShared) {
        setError(t('locations.share.alreadySharedWithGroup'));
        setIsLoading(false);
        return;
      }

      const newShare = await customLocationService.shareWithGroup(location.id, selectedGroup.id);
      setShares(prev => ({
        ...prev,
        group_shares: [...prev.group_shares, { ...newShare, group_name: getGroupDisplayName(selectedGroup) }],
      }));
      setSelectedGroup(null);
      onUpdated?.();
    } catch (err: unknown) {
      if (import.meta.env.DEV) console.error('Failed to share with group:', err);
      const errorObj = err as { response?: { data?: { error?: string; message?: string } } };
      setError(errorObj.response?.data?.error || errorObj.response?.data?.message || t('locations.share.failedToShare'));
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveGroupShare = async (shareId: number) => {
    if (!location?.id) return;

    try {
      await customLocationService.removeGroupShare(location.id, shareId);
      setShares(prev => ({
        ...prev,
        group_shares: prev.group_shares.filter(s => s.id !== shareId),
      }));
      onUpdated?.();
    } catch (err) {
      if (import.meta.env.DEV) console.error('Failed to remove group share:', err);
    }
  };

  if (!location) return null;

  const totalShares = shares.user_shares.length + shares.workspace_shares.length + shares.group_shares.length;

  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent className="!max-w-[28rem] max-h-[90vh] flex flex-col p-0 gap-0">
        <AlertDialogHeader className="p-6 border-b border-border relative">
          <AlertDialogTitle className="text-xl font-semibold text-foreground">
            {t('locations.share.title')}
          </AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-muted-foreground mt-1">
            {t('locations.share.description', { name: location.title })}
          </AlertDialogDescription>
          <button
            onClick={onClose}
            className="absolute right-3 top-3 p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
          >
            <IconX className="w-4 h-4" />
          </button>
        </AlertDialogHeader>

        <div className="flex border-b border-border px-6">
          <button
            onClick={() => setActiveTab('users')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'users'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Users className="w-4 h-4" />
            {t('locations.share.tabs.users')}
          </button>
          <button
            onClick={() => setActiveTab('workspaces')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'workspaces'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Folder className="w-4 h-4" />
            {t('locations.share.tabs.workspaces')}
          </button>
          <button
            onClick={() => setActiveTab('groups')}
            className={`flex items-center gap-2 px-4 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'groups'
                ? 'border-primary text-foreground'
                : 'border-transparent text-muted-foreground hover:text-foreground'
            }`}
          >
            <Building2 className="w-4 h-4" />
            {t('locations.share.tabs.groups')}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'users' && (
            <div className="space-y-6">
              <form onSubmit={handleAddUserShare} className="space-y-4">
                <div>
                  <label htmlFor="user-email-input" className="block text-sm font-medium text-foreground mb-2">
                    {t('locations.share.userEmail')}<span className="text-destructive ml-1">*</span>
                  </label>
                  <input
                    id="user-email-input"
                    type="email"
                    value={userFormData.email}
                    onChange={(e) => {
                      setUserFormData({ email: e.target.value });
                      setError('');
                    }}
                    placeholder="user@example.com"
                    className="w-full h-10 px-3 border border-border rounded-lg focus:ring-2 focus:ring-ring focus:border-border bg-background dark:bg-input text-foreground text-sm disabled:opacity-50 disabled:cursor-not-allowed placeholder-muted-foreground"
                    disabled={isLoading}
                    required
                    autoFocus
                  />
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <button
                  type="submit"
                  disabled={isLoading || !userFormData.email.trim()}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <UserPlus className="w-4 h-4" />
                  {t('locations.share.addUser')}
                </button>
              </form>

              <div>
                <h3 className="text-sm font-medium text-foreground mb-3">
                  {t('locations.share.sharedWithUsers')} ({shares.user_shares.length})
                </h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {isLoadingShares ? (
                    <p className="text-sm text-muted-foreground text-center py-4">{t('common.loading')}</p>
                  ) : shares.user_shares.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">{t('locations.share.noUsersYet')}</p>
                  ) : (
                    shares.user_shares.map((share) => (
                      <div
                        key={share.id}
                        className="flex items-center justify-between p-3 bg-muted rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium">
                            {share.email?.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground">{share.email}</p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveUserShare(share.id)}
                          className="p-2 text-muted-foreground hover:text-destructive transition-colors"
                          title={t('locations.share.removeAccess')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'workspaces' && (
            <div className="space-y-6">
              <form onSubmit={handleAddWorkspaceShare} className="space-y-4">
                <div>
                  <div className="block text-sm font-medium text-foreground mb-2" id="workspace-selector-label">
                    {t('locations.share.selectWorkspace')}<span className="text-destructive ml-1">*</span>
                  </div>
                  <div aria-labelledby="workspace-selector-label">
                    <WorkspaceSelector
                      onWorkspaceChange={setSelectedWorkspace}
                      activeWorkspace={selectedWorkspace}
                    />
                  </div>
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <button
                  type="submit"
                  disabled={isLoading || !selectedWorkspace}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <UserPlus className="w-4 h-4" />
                  {t('locations.share.addWorkspace')}
                </button>
              </form>

              <div>
                <h3 className="text-sm font-medium text-foreground mb-3">
                  {t('locations.share.sharedWithWorkspaces')} ({shares.workspace_shares.length})
                </h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {isLoadingShares ? (
                    <p className="text-sm text-muted-foreground text-center py-4">{t('common.loading')}</p>
                  ) : shares.workspace_shares.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">{t('locations.share.noWorkspacesYet')}</p>
                  ) : (
                    shares.workspace_shares.map((share) => (
                      <div
                        key={share.id}
                        className="flex items-center justify-between p-3 bg-muted rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                            <Folder className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              {share.workspace_name || `Workspace ${share.workspace_id}`}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveWorkspaceShare(share.id)}
                          className="p-2 text-muted-foreground hover:text-destructive transition-colors"
                          title={t('locations.share.removeAccess')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'groups' && (
            <div className="space-y-6">
              <form onSubmit={handleAddGroupShare} className="space-y-4">
                <div>
                  <div className="block text-sm font-medium text-foreground mb-2" id="group-selector-label">
                    {t('locations.share.selectGroup')}<span className="text-destructive ml-1">*</span>
                  </div>
                  <div aria-labelledby="group-selector-label">
                    <GroupSelector
                      onGroupChange={setSelectedGroup}
                      disabled={isLoading}
                      activeGroup={selectedGroup}
                      accessLevel={user?.access_level}
                    />
                  </div>
                </div>
                {error && <p className="text-sm text-destructive">{error}</p>}
                <button
                  type="submit"
                  disabled={isLoading || !selectedGroup}
                  className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  <UserPlus className="w-4 h-4" />
                  {t('locations.share.addGroup')}
                </button>
              </form>

              <div>
                <h3 className="text-sm font-medium text-foreground mb-3">
                  {t('locations.share.sharedWithGroups')} ({shares.group_shares.length})
                </h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {isLoadingShares ? (
                    <p className="text-sm text-muted-foreground text-center py-4">{t('common.loading')}</p>
                  ) : shares.group_shares.length === 0 ? (
                    <p className="text-sm text-muted-foreground text-center py-4">{t('locations.share.noGroupsYet')}</p>
                  ) : (
                    shares.group_shares.map((share) => (
                      <div
                        key={share.id}
                        className="flex items-center justify-between p-3 bg-muted rounded-lg"
                      >
                        <div className="flex items-center gap-3">
                          <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                            <Building2 className="w-4 h-4" />
                          </div>
                          <div>
                            <p className="text-sm font-medium text-foreground">
                              {formatGroupName(share.group_name || share.group_id || '')}
                            </p>
                          </div>
                        </div>
                        <button
                          onClick={() => handleRemoveGroupShare(share.id)}
                          className="p-2 text-muted-foreground hover:text-destructive transition-colors"
                          title={t('locations.share.removeAccess')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between p-6 border-t border-border">
          <span className="text-sm text-muted-foreground">
            {t('locations.share.totalShares', { count: totalShares })}
          </span>
          <button
            onClick={onClose}
            className="px-4 py-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
          >
            {t('common.close')}
          </button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
};
