import React, { useState, useEffect, useRef } from 'react';
import { Users, Building2, Trash2, UserPlus } from 'lucide-react';
import { IconX } from '@tabler/icons-react';
import { workspaceService, type Workspace } from '@/components/workspace/services/workspaceService';
import { GroupSelector } from '@/components/group/GroupSelector';
import type { Group } from '@/components/workspace/services/groupService';
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

interface ShareWorkspaceModalProps {
  isOpen: boolean;
  workspace: Workspace | null;
  onClose: () => void;
  onUpdated?: () => void;
}

type ShareTab = 'users' | 'groups';

export const ShareWorkspaceModal: React.FC<ShareWorkspaceModalProps> = ({
  isOpen,
  workspace,
  onClose,
  onUpdated
}) => {
  const { t } = useTranslation();
  const { user } = useAuthStore();
  const [activeTab, setActiveTab] = useState<ShareTab>('users');
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string>('');
  const [localMembers, setLocalMembers] = useState(workspace?.members ?? []);
  const [localGroups, setLocalGroups] = useState(workspace?.groups ?? []);

  const [userFormData, setUserFormData] = useState({ email: '' });

  const wasOpenRef = useRef<boolean>(isOpen);

  useEffect(() => {
    if (wasOpenRef.current && !isOpen) {
      setUserFormData({ email: '' });
      setSelectedGroup(null);
      setError('');
      setActiveTab('users');
    }
    wasOpenRef.current = isOpen;
  }, [isOpen]);

  useEffect(() => {
    setLocalMembers(workspace?.members ?? []);
    setLocalGroups(workspace?.groups ?? []);
  }, [workspace?.id, isOpen, workspace?.members, workspace?.groups]);


  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace?.id || !userFormData.email.trim()) return;

    setError('');
    setIsLoading(true);

    try {
  const inputEmail = userFormData.email.trim().toLowerCase();
  const isAlreadyMember = (localMembers ?? []).some(m => m.email?.toLowerCase() === inputEmail);

      if (isAlreadyMember) {
        setError('This user is already a member of this workspace.');
        setIsLoading(false);
        return;
      }

      const newMember = await workspaceService.addMember(workspace.id, {
        email: inputEmail
      });
      setLocalMembers((prev) => [...prev, newMember]);
      setUserFormData({ email: '' });
      onUpdated?.();
    } catch (err: unknown) {
      if (import.meta.env.DEV) console.error('Failed to add member:', err);
      const errorObj = err as { response?: { data?: { error?: string; message?: string } } };
      setError(errorObj.response?.data?.error || errorObj.response?.data?.message || 'Failed to add member. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveMember = async (memberId: number) => {
    if (!workspace?.id) return;

    try {
      await workspaceService.removeMember(workspace.id, memberId);
      setLocalMembers((prev) => prev.filter((m) => m.id !== memberId));
      onUpdated?.();
    } catch (err) {
      if (import.meta.env.DEV) console.error('Failed to remove member:', err);
    }
  };

  const handleAddGroup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!workspace?.id || !selectedGroup) {
      return;
    }

    setError('');
    setIsLoading(true);

    try {
  const isAlreadyAdded = (localGroups ?? []).some(g => g.group_id === selectedGroup.id);

      if (isAlreadyAdded) {
        setError('This group already has access to this workspace.');
        setIsLoading(false);
        return;
      }

      const newGroup = await workspaceService.addGroup(workspace.id, {
        group_id: selectedGroup.id,
        group_name: getGroupDisplayName(selectedGroup)
      });
      setLocalGroups((prev) => [...prev, newGroup]);
      onUpdated?.();
    } catch (err: unknown) {
      if (import.meta.env.DEV) console.error('Failed to add group:', err);
      const errorObj = err as { response?: { data?: { error?: string; message?: string } } };
      setError(errorObj.response?.data?.error || errorObj.response?.data?.message || 'Failed to add group. Please try again.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleRemoveGroup = async (groupId: string) => {
    if (!workspace?.id) return;

    try {
      await workspaceService.removeGroup(workspace.id, groupId);
      setLocalGroups((prev) => prev.filter((g) => g.group_id !== groupId));
      onUpdated?.();
    } catch (err) {
      if (import.meta.env.DEV) console.error('Failed to remove group:', err);
    }
  };

  if (!workspace) return null;

  return (
    <AlertDialog open={isOpen} onOpenChange={onClose}>
      <AlertDialogContent className="!max-w-[26rem] max-h-[90vh] flex flex-col p-0 gap-0">
        <AlertDialogHeader className="p-6 border-b border-border relative">
          <AlertDialogTitle className="text-xl font-semibold text-foreground">Share Workspace</AlertDialogTitle>
          <AlertDialogDescription className="text-sm text-muted-foreground mt-1">
            Share "{workspace.name}" with users or groups
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
            Individual Users
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
            Groups
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {activeTab === 'users' ? (
            <div className="space-y-6">
              <form onSubmit={handleAddMember} className="space-y-4">
                <div>
                  <label htmlFor="user-email-input" className="block text-sm font-medium text-foreground mb-2">
                    User Email<span className="text-destructive ml-1">*</span>
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
                  Add Member
                </button>
              </form>

              <div>
                <h3 className="text-sm font-medium text-foreground mb-3">Current Members ({localMembers?.length || 0})</h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {localMembers?.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">{t('workspace.noMembersYet')}</p>
                  )}
                  {localMembers?.map((member) => (
                    <div
                      key={member.id}
                      className="flex items-center justify-between p-3 bg-muted rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-sm font-medium">
                          {member.email.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{member.email}</p>
                        </div>
                      </div>
                      {member.user_id !== workspace.user_id && (
                        <button
                          onClick={() => handleRemoveMember(member.id)}
                          className="p-2 text-muted-foreground hover:text-destructive transition-colors"
                          title={t('workspace.removeMember')}
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              <form onSubmit={handleAddGroup} className="space-y-4">
                <div>
                  <div className="block text-sm font-medium text-foreground mb-2" id="group-selector-label">
                    Select Group<span className="text-destructive ml-1">*</span>
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
                  Add Group
                </button>
              </form>

              <div>
                <h3 className="text-sm font-medium text-foreground mb-3">Shared with Groups ({localGroups?.length || 0})</h3>
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {localGroups?.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">{t('workspace.noGroupsYet')}</p>
                  )}
                  {localGroups?.map((group) => (
                    <div
                      key={group.id}
                      className="flex items-center justify-between p-3 bg-muted rounded-lg"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center">
                          <Building2 className="w-4 h-4" />
                        </div>
                        <div>
                          <p className="text-sm font-medium text-foreground">{formatGroupName(group.group_name)}</p>
                        </div>
                      </div>
                      <button
                        onClick={() => handleRemoveGroup(group.group_id)}
                        className="p-2 text-muted-foreground hover:text-destructive transition-colors"
                        title={t('workspace.removeGroup')}
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 p-6 border-t border-border">
          <button
            onClick={onClose}
            className="px-4 py-2 text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg transition-colors"
          >
            Done
          </button>
        </div>
      </AlertDialogContent>
    </AlertDialog>
  );
};
