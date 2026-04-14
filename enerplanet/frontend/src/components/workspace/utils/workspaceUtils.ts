import { Workspace, workspaceService } from '@/components/workspace/services/workspaceService';

/**
 * Ensures a default workspace exists in the workspace list
 * Fetches the default workspace from the server if not found in the list
 * Prioritizes the default workspace at the beginning of the list
 *
 * @param workspaceList - Current list of workspaces
 * @returns Updated workspace list with default workspace prioritized
 */
export async function ensureDefaultWorkspace(workspaceList: Workspace[]): Promise<Workspace[]> {
    let defaultWorkspace = workspaceList.find(w => w.is_default) || null;

    // If no default workspace in list, try to fetch it
    if (!defaultWorkspace) {
        try {
            const fetchedDefault = await workspaceService.getDefaultWorkspace();
            defaultWorkspace = fetchedDefault;

            // Add to list if it doesn't already exist
            const exists = workspaceList.some(w => w.id === fetchedDefault.id);
            if (!exists) {
                workspaceList = [fetchedDefault, ...workspaceList];
            }
        } catch (error) {
            if (import.meta.env.DEV) console.error('Failed to ensure default workspace exists:', error);
        }
    }

    // Prioritize default workspace at the beginning
    if (defaultWorkspace) {
        workspaceList = [
            defaultWorkspace,
            ...workspaceList.filter(w => w.id !== defaultWorkspace.id)
        ];
    }

    return workspaceList;
}
