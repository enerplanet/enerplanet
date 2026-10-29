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
    /** Shown once */
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
    /** Expiry days */
    expires_in_days?: number;
    scope?: 'read' | 'full';
}

export function createApiTokensService(userId?: string | number) {
    const path = userId === undefined ? '/users/profile/tokens' : `/users/${encodeURIComponent(userId)}/tokens`;
    return {
        async list(): Promise<ApiToken[]> {
            const { data } = await axios.get<ApiResponse<ApiToken[]>>(path);
            return data.data ?? [];
        },

        async create(payload: CreateApiTokenPayload): Promise<CreatedApiToken> {
            const { data } = await axios.post<ApiResponse<CreatedApiToken>>(path, payload);
            return data.data;
        },

        async revoke(tokenId: number): Promise<void> {
            await axios.delete(`${path}/${tokenId}`);
        },
    };
}
