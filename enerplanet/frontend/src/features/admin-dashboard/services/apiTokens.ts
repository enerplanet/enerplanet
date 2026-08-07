import axios from '@/lib/axios';

interface ApiResponse<T> {
    success: boolean;
    data: T;
}

export interface ApiToken {
    id: number;
    user_id: string;
    user_email: string;
    name: string;
    token_prefix: string;
    scope: 'read' | 'full';
    access_level: string;
    created_by: string;
    expires_at?: string | null;
    last_used_at?: string | null;
    revoked_at?: string | null;
    created_at: string;
}

export interface CreatedApiToken {
    /** Full plaintext token — available only in this response, never again. */
    token: string;
    id: number;
    name: string;
    prefix: string;
    scope: string;
    expires_at?: string | null;
    created_at: string;
}

export interface CreateApiTokenPayload {
    name: string;
    /** undefined → server default (90 days); 0 → never expires. */
    expires_in_days?: number;
    scope?: 'read' | 'full';
}

export const apiTokensService = {
    async list(userId: string | number): Promise<ApiToken[]> {
        const { data } = await axios.get<ApiResponse<ApiToken[]>>(`/users/${userId}/tokens`);
        return data.data ?? [];
    },

    async create(userId: string | number, payload: CreateApiTokenPayload): Promise<CreatedApiToken> {
        const { data } = await axios.post<ApiResponse<CreatedApiToken>>(`/users/${userId}/tokens`, payload);
        return data.data;
    },

    async revoke(userId: string | number, tokenId: number): Promise<void> {
        await axios.delete(`/users/${userId}/tokens/${tokenId}`);
    },
};
