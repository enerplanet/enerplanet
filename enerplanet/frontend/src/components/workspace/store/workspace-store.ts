import { create } from 'zustand';
import { type Workspace, workspaceService } from '@/components/workspace/services/workspaceService';

type WorkspaceState = {
  currentWorkspace: Workspace | null;
  preferredWorkspaceId: number | null;
  isLoading: boolean;
  isInitialized: boolean;

  setCurrentWorkspace: (workspace: Workspace | null) => void;
  setPreferredWorkspaceId: (id: number | null) => void;
  loadPreferredWorkspace: () => Promise<void>;
  savePreferredWorkspace: (workspaceId: number | null) => Promise<void>;
  initializeWorkspace: () => Promise<void>;
};

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  currentWorkspace: null,
  preferredWorkspaceId: null,
  isLoading: false,
  isInitialized: false,

  setCurrentWorkspace: (workspace) => {
    set({ currentWorkspace: workspace });
    const workspaceId = workspace?.id ?? null;
    get().savePreferredWorkspace(workspaceId);
  },

  setPreferredWorkspaceId: (id) => {
    set({ preferredWorkspaceId: id });
  },

  loadPreferredWorkspace: async () => {
    try {
      set({ isLoading: true });
      const preferredId = await workspaceService.getPreferredWorkspace();
      set({ preferredWorkspaceId: preferredId, isLoading: false });
    } catch (error) {
      if (import.meta.env.DEV) console.error('Failed to load preferred workspace:', error);
      set({ isLoading: false });
      throw error;
    }
  },

  savePreferredWorkspace: async (workspaceId) => {
    try {
      await workspaceService.setPreferredWorkspace(workspaceId);
      set({ preferredWorkspaceId: workspaceId });
    } catch (error) {
      if (import.meta.env.DEV) console.error('Failed to save preferred workspace:', error);
    }
  },

  initializeWorkspace: async () => {
    if (get().isInitialized) return;

    try {
      set({ isLoading: true });
      const preferredId = await workspaceService.getPreferredWorkspace();

      if (preferredId) {
        try {
          const workspaces = await workspaceService.getUserWorkspaces();
          const preferredWorkspace = workspaces.find(w => w.id === preferredId);

          set({
            preferredWorkspaceId: preferredId,
            currentWorkspace: preferredWorkspace || null,
            isLoading: false,
            isInitialized: true
          });
        } catch (wsError) {
          if (import.meta.env.DEV) console.error('Failed to load preferred workspace details:', wsError);
          set({
            preferredWorkspaceId: preferredId,
            isLoading: false,
            isInitialized: true
          });
        }
      } else {
        set({
          preferredWorkspaceId: preferredId,
          isLoading: false,
          isInitialized: true
        });
      }
    } catch (error) {
      if (import.meta.env.DEV) console.error('Failed to initialize workspace:', error);
      set({ isLoading: false, isInitialized: true });
    }
  },
}));
