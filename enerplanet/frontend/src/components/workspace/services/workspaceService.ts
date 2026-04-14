import { BaseApiService } from '@/services/base';

export interface Workspace {
    id: number;
    name: string;
    description: string;
    user_id: string;
    user_email: string;
    is_default: boolean;
    created_at: string;
    updated_at: string;
    members?: WorkspaceMember[];
    groups?: WorkspaceGroup[];
}

interface WorkspaceMember {
    id: number;
    workspace_id: number;
    user_id: string;
    email: string;
    joined_at: string;
    created_at: string;
    updated_at: string;
}

interface WorkspaceGroup {
    id: number;
    workspace_id: number;
    group_id: string;
    group_name: string;
    created_at: string;
    updated_at: string;
}

interface CreateWorkspaceRequest {
    name: string;
    description?: string;
}

interface UpdateWorkspaceRequest {
    name?: string;
    description?: string;
}

interface AddMemberRequest {
    email: string;
}

interface AddGroupRequest {
    group_id: string;
    group_name: string;
}

class WorkspaceService extends BaseApiService {
    constructor() {
        super('');
    }

    async getUserWorkspaces(): Promise<Workspace[]> {
        const response = await this.get<{ success: boolean; data: Workspace[] }>('/workspaces');
        return response.data;
    }

    async getDefaultWorkspace(): Promise<Workspace> {
        const response = await this.get<{ success: boolean; data: Workspace }>('/workspaces/default');
        return response.data;
    }

    async getWorkspace(id: number): Promise<Workspace> {
        const response = await this.get<{ success: boolean; data: Workspace }>(`/workspaces/${id}`);
        return response.data;
    }

    async createWorkspace(data: CreateWorkspaceRequest): Promise<Workspace> {
        const response = await this.post<{ success: boolean; data: Workspace }>('/workspaces', data);
        return response.data;
    }

    async updateWorkspace(id: number, data: UpdateWorkspaceRequest): Promise<void> {
        await this.put(`/workspaces/${id}`, data);
    }

    async copyWorkspace(id: number, name: string, description?: string): Promise<Workspace> {
        const response = await this.post<{ success: boolean; data: Workspace }>(
            `/workspaces/${id}/copy`,
            { name, description }
        );
        return response.data;
    }

    async renameWorkspace(id: number, name: string): Promise<void> {
        await this.put(`/workspaces/${id}`, { name });
    }

    async deleteWorkspace(id: number): Promise<void> {
        await this.delete(`/workspaces/${id}`);
    }

    async addMember(workspaceId: number, data: AddMemberRequest): Promise<WorkspaceMember> {
        const response = await this.post<{ success: boolean; data: WorkspaceMember }>(
            `/workspaces/${workspaceId}/members`,
            data
        );
        return response.data;
    }

    async removeMember(workspaceId: number, memberId: number): Promise<void> {
        await this.delete(`/workspaces/${workspaceId}/members/${memberId}`);
    }

    async getPreferredWorkspace(): Promise<number | null> {
        const response = await this.get<{ success: boolean; data: { preferred_workspace_id: number | null } }>('/workspaces/preferred');
        return response.data.preferred_workspace_id;
    }

    async setPreferredWorkspace(workspaceId: number | null): Promise<void> {
        await this.put('/workspaces/preferred', { workspace_id: workspaceId });
    }

    async addGroup(workspaceId: number, data: AddGroupRequest): Promise<WorkspaceGroup> {
        const response = await this.post<{ success: boolean; data: WorkspaceGroup }>(
            `/workspaces/${workspaceId}/groups`,
            data
        );
        return response.data;
    }

    async removeGroup(workspaceId: number, groupId: string): Promise<void> {
        await this.delete(`/workspaces/${workspaceId}/groups/${groupId}`);
    }

}

export const workspaceService = new WorkspaceService();
