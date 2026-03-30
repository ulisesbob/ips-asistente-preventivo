// API client with automatic token refresh on 401

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ApiSuccessResponse<T> {
  status: 'ok';
  data: T;
}

export interface ApiErrorResponse {
  status: 'error';
  message: string;
}

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;

export class ApiError extends Error {
  constructor(
    message: string,
    public statusCode: number,
    public responseBody?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

// ── Token management (module-level for SSR compat) ─────────────────────────────

let accessToken: string | null = null;

export function getAccessToken(): string | null {
  return accessToken;
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

// ── Refresh logic ──────────────────────────────────────────────────────────────

let refreshPromise: Promise<string> | null = null;

async function refreshAccessToken(): Promise<string> {
  // Deduplicate concurrent refresh calls
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    try {
      const res = await fetch('/api/auth/refresh', {
        method: 'POST',
        credentials: 'include', // send httpOnly cookie
      });

      if (!res.ok) {
        throw new ApiError('Session expired', res.status);
      }

      const json: ApiResponse<{ accessToken: string }> = await res.json();

      if (json.status === 'error') {
        throw new ApiError(json.message, 401);
      }

      const newToken = json.data.accessToken;
      setAccessToken(newToken);
      return newToken;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

// ── Core fetch wrapper ─────────────────────────────────────────────────────────

async function apiFetch<T>(
  url: string,
  options: RequestInit = {},
): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };

  if (accessToken) {
    headers['Authorization'] = `Bearer ${accessToken}`;
  }

  let res = await fetch(url, {
    ...options,
    headers,
    credentials: 'include',
  });

  // On 401, try refreshing the token once and retry
  if (res.status === 401 && accessToken) {
    try {
      const newToken = await refreshAccessToken();
      headers['Authorization'] = `Bearer ${newToken}`;

      res = await fetch(url, {
        ...options,
        headers,
        credentials: 'include',
      });
    } catch {
      // Refresh failed — throw the original 401
      setAccessToken(null);
      throw new ApiError('Session expired', 401);
    }
  }

  const json: ApiResponse<T> = await res.json();

  if (json.status === 'error') {
    throw new ApiError(json.message, res.status, json);
  }

  return json.data;
}

// ── Public helpers ─────────────────────────────────────────────────────────────

export async function apiGet<T>(url: string): Promise<T> {
  return apiFetch<T>(url, { method: 'GET' });
}

export async function apiPost<T>(url: string, body?: unknown): Promise<T> {
  return apiFetch<T>(url, {
    method: 'POST',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export async function apiPatch<T>(url: string, body?: unknown): Promise<T> {
  return apiFetch<T>(url, {
    method: 'PATCH',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

export async function apiDelete<T = void>(url: string): Promise<T> {
  return apiFetch<T>(url, { method: 'DELETE' });
}
