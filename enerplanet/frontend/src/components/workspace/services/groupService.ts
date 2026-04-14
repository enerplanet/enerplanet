import { BaseApiService } from '@/services/base';

export interface Group {
    id: string;
    name: string;
    path: string;
    disabled?: boolean;
    attributes?: Record<string, string[]>;
}

interface GroupMember {
    id: string;
    username?: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    enabled?: boolean;
    attributes?: Record<string, unknown>;
    [key: string]: unknown;
}

interface CreateGroupRequest {
    name: string;
}

interface UpdateGroupRequest {
    name: string;
}

interface AddMemberRequest {
    user_id: string;
}

class GroupService extends BaseApiService {
    constructor() {
        super('');
    }

    async getMyGroup(): Promise<Group> {
        const response = await this.get<{ success: boolean; data: Group }>('/groups/my');
        return response.data;
    }

    async getGroups(): Promise<Group[]> {
        const response = await this.get<{ success: boolean; data: Group[] }>('/groups');
        return response.data;
    }

    async getGroupDetail(id: string): Promise<Group> {
        const response = await this.get<{ success: boolean; data: Group }>(`/groups/${id}`);
        return response.data;
    }

    async createGroup(data: CreateGroupRequest): Promise<{ message: string }> {
        const response = await this.post<{ success: boolean; data: { message: string } }>('/groups', data);
        return response.data;
    }

    async updateGroup(id: string, data: UpdateGroupRequest): Promise<{ message: string }> {
        const response = await this.put<{ success: boolean; data: { message: string } }>(`/groups/${id}`, data);
        return response.data;
    }

    async deleteGroup(id: string): Promise<void> {
        await this.delete(`/groups/${id}`);
    }

    async disableGroup(id: string): Promise<{ message: string; users_disabled: number; users_failed: number }> {
        const res = await this.put<{ success: boolean; data: { message: string; users_disabled: number; users_failed: number } }>(`/groups/${id}/disable`, {});
        return res.data;
    }

    async enableGroup(id: string): Promise<{ message: string; users_enabled: number; users_failed: number }> {
        const res = await this.put<{ success: boolean; data: { message: string; users_enabled: number; users_failed: number } }>(`/groups/${id}/enable`, {});
        return res.data;
    }

    async getGroupMembers(groupId: string): Promise<GroupMember[]> {
        const response = await this.get<{ success: boolean; data: GroupMember[] }>(`/groups/${groupId}/members`);
        return response.data;
    }

    async addMember(groupId: string, data: AddMemberRequest): Promise<{ message: string }> {
        const response = await this.post<{ success: boolean; data: { message: string } }>(
            `/groups/${groupId}/members`,
            data
        );
        return response.data;
    }

    async removeMember(groupId: string, userId: string): Promise<void> {
        await this.delete(`/groups/${groupId}/members/${userId}`);
    }
}

export const groupService = new GroupService();
