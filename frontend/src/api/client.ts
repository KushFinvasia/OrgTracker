const TOKEN_KEY = "orgtrack.token";

/** Backend origin. Empty in local dev (Vite proxies /api); set VITE_API_URL on Vercel, e.g. https://orgtrack-api.onrender.com */
export const API_BASE = `${(import.meta.env.VITE_API_URL ?? "").replace(/\/+$/, "")}/api`;

export class ApiError extends Error {
  status: number;
  field?: string | null;
  code?: string;
  current?: unknown;

  constructor(status: number, message: string, field?: string | null, code?: string, current?: unknown) {
    super(message);
    this.status = status;
    this.field = field;
    this.code = code;
    this.current = current;
  }
}

export function getToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null) {
  try {
    if (token) localStorage.setItem(TOKEN_KEY, token);
    else localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: session lasts for this tab only */
  }
}

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

async function request<T>(method: string, path: string, body?: unknown, isForm = false, extraHeaders: Record<string, string> = {}): Promise<T> {
  const headers: Record<string, string> = { ...extraHeaders };
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !isForm) headers["Content-Type"] = "application/json";
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, "Cannot reach the server. It may be waking up (free hosting sleeps when idle); retry in a minute. Your draft is kept.", null, "network");
  }
  if (res.status === 401 && onUnauthorized) onUnauthorized();
  if (!res.ok) {
    let detail: { message?: string; field?: string; code?: string; current?: unknown } | string | undefined;
    try {
      const data = await res.json();
      detail = data.detail;
    } catch {
      detail = undefined;
    }
    if (Array.isArray(detail)) {
      const first = detail[0] as { loc?: string[]; msg?: string };
      throw new ApiError(res.status, first?.msg ?? "Check the highlighted fields.", first?.loc?.[first.loc.length - 1], "validation");
    }
    if (typeof detail === "object" && detail) throw new ApiError(res.status, detail.message ?? "Request failed.", detail.field, detail.code, detail.current);
    throw new ApiError(res.status, typeof detail === "string" ? detail : `Request failed (${res.status}).`);
  }
  if (res.headers.get("content-type")?.includes("application/json")) return (await res.json()) as T;
  return (await res.text()) as unknown as T;
}

export const api = {
  get: <T>(path: string, headers?: Record<string, string>) => request<T>("GET", path, undefined, false, headers),
  post: <T>(path: string, body?: unknown) => request<T>("POST", path, body ?? {}),
  patch: <T>(path: string, body: unknown) => request<T>("PATCH", path, body),
  put: <T>(path: string, body: unknown) => request<T>("PUT", path, body),
  upload: <T>(path: string, file: File) => {
    const fd = new FormData();
    fd.append("file", file);
    return request<T>("POST", path, fd, true);
  },
  download: async (path: string, filename: string) => {
    const token = getToken();
    const res = await fetch(`${API_BASE}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    if (!res.ok) throw new ApiError(res.status, "Download failed.");
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
  },
};
