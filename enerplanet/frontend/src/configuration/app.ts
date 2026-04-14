import { API_CONFIG } from '@/constants';

export const config = {
  api: {
    baseUrl: API_CONFIG.BASE_URL,
    timeout: API_CONFIG.TIMEOUT,
  },
  app: {
    name: 'fire',
    version: '1.0.0',
    environment: import.meta.env.MODE || 'development',
  },
} as const;
