import {
  User,
  Email,
  Sender,
  ListEmailsResponse,
  SlackStatus,
  SchedulePayload,
  BatchSchedulePayload,
} from '../types';

const API_BASE = import.meta.env.VITE_API_URL || '';

class ApiError extends Error {
  constructor(public status: number, message: string, public details?: any) {
    super(message);
    this.name = 'ApiError';
  }
}

async function fetchJson<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const headers = new Headers(options.headers || {});

  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(url, {
    ...options,
    headers,
    credentials: 'include', // Ensure session cookies are sent and received
  });

  const contentType = response.headers.get('content-type');
  const isJson = contentType && contentType.includes('application/json');
  const data = isJson ? await response.json() : null;

  if (!response.ok) {
    const message = data?.error?.message || data?.message || `HTTP error ${response.status}`;
    throw new ApiError(response.status, message, data?.error?.details || data);
  }

  return data as T;
}

export const api = {
  auth: {
    getMe: async (): Promise<{ success: boolean; user: User }> => {
      return fetchJson<{ success: boolean; user: User }>('/api/auth/me');
    },
    logout: async (): Promise<{ success: boolean; message: string }> => {
      return fetchJson<{ success: boolean; message: string }>('/api/auth/logout', {
        method: 'POST',
      });
    },
    getGoogleLoginUrl: (): string => {
      return `${API_BASE}/api/auth/google`;
    },
  },

  emails: {
    list: async (params?: {
      status?: string;
      page?: number;
      limit?: number;
    }): Promise<ListEmailsResponse> => {
      const searchParams = new URLSearchParams();
      if (params?.status) searchParams.set('status', params.status);
      if (params?.page) searchParams.set('page', String(params.page));
      if (params?.limit) searchParams.set('limit', String(params.limit));

      const query = searchParams.toString();
      return fetchJson<ListEmailsResponse>(`/api/emails${query ? `?${query}` : ''}`);
    },

    getById: async (id: string): Promise<{ success: boolean; data: Email }> => {
      return fetchJson<{ success: boolean; data: Email }>(`/api/emails/${id}`);
    },

    listSenders: async (): Promise<{ success: boolean; data: Sender[] }> => {
      return fetchJson<{ success: boolean; data: Sender[] }>('/api/emails/senders');
    },

    schedule: async (payload: SchedulePayload): Promise<{ success: boolean; data: Email }> => {
      return fetchJson<{ success: boolean; data: Email }>('/api/emails/schedule', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    scheduleBatch: async (
      payload: BatchSchedulePayload
    ): Promise<{
      success: boolean;
      scheduled: number;
      firstScheduledAt: string;
      lastScheduledAt: string;
    }> => {
      return fetchJson<{
        success: boolean;
        scheduled: number;
        firstScheduledAt: string;
        lastScheduledAt: string;
      }>('/api/emails/schedule-batch', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    },

    search: async (
      query: string,
      status?: string
    ): Promise<{ success: boolean; total: number; data: Email[] }> => {
      const searchParams = new URLSearchParams({ q: query });
      if (status) searchParams.set('status', status);

      return fetchJson<{ success: boolean; total: number; data: Email[] }>(
        `/api/search/emails?${searchParams.toString()}`
      );
    },
  },

  slack: {
    getStatus: async (): Promise<SlackStatus> => {
      return fetchJson<SlackStatus>('/api/slack/status');
    },
    getConnectUrl: (): string => {
      return `${API_BASE}/api/slack/connect`;
    },
    disconnect: async (): Promise<{ success: boolean; message: string }> => {
      return fetchJson<{ success: boolean; message: string }>('/api/slack/disconnect', {
        method: 'POST',
      });
    },
  },
};

export { ApiError };
