// JSON client for the collaboration server (same origin). Sends the session
// cookie and the CSRF token that GET /api/auth/session hands out.

let csrf: string | null = null;

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  constructor(message: string, status: number, code?: string) { super(message); this.status = status; this.code = code; }
}

function readCsrfCookie(): string | null {
  const m = /(?:^|;\s*)csrf-token=([^;]+)/.exec(typeof document === 'undefined' ? '' : document.cookie);
  return m ? decodeURIComponent(m[1]) : null;
}

export function setCsrf(token: string | null | undefined) { csrf = token ?? null; }

async function request<T>(method: string, url: string, body?: unknown, raw = false): Promise<T> {
  const headers: Record<string, string> = {};
  if (method !== 'GET') {
    const token = readCsrfCookie() ?? csrf;
    if (token) headers['X-CSRF-Token'] = token;
  }
  let payload: BodyInit | undefined;
  if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = typeof body === 'string' ? body : JSON.stringify(body);
  }
  let res: Response;
  try {
    res = await fetch(url, { method, headers, body: payload, credentials: 'same-origin' });
  } catch {
    throw new ApiError('Cannot reach the PLS Studio server. Check your connection.', 0);
  }
  if (raw && res.ok) return (await res.text()) as T;
  const data = res.headers.get('content-type')?.includes('application/json') ? await res.json().catch(() => ({})) : {};
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status}).`, res.status, (data as { code?: string }).code);
  return data as T;
}

export const api = {
  get: <T>(url: string) => request<T>('GET', url),
  getText: (url: string) => request<string>('GET', url, undefined, true),
  post: <T>(url: string, body?: unknown) => request<T>('POST', url, body ?? {}),
  put: <T>(url: string, body: unknown) => request<T>('PUT', url, body),
  patch: <T>(url: string, body: unknown) => request<T>('PATCH', url, body),
  del: <T>(url: string) => request<T>('DELETE', url),
};
