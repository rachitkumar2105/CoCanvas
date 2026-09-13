import type {
  AuthResponse,
  CollabTokenResponse,
  DocumentResponse,
  VersionResponse,
  WorkspaceResponse,
} from "./types";

export const CORE_API_URL = process.env.NEXT_PUBLIC_CORE_API_URL ?? "http://localhost:8080";

// The access token lives only in memory (Section 8) — never localStorage — so a page
// reload always starts from a fresh /api/auth/refresh using the httpOnly cookie.
let accessToken: string | null = null;
let onUnauthorized: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

export function setUnauthorizedHandler(handler: (() => void) | null): void {
  onUnauthorized = handler;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function parseBody(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/**
 * Every call attempts a silent /api/auth/refresh exactly once on a 401 (the access
 * token is short-lived by design, Section 8) before giving up and forcing sign-in.
 */
async function request<T>(path: string, options: RequestInit = {}, isRetry = false): Promise<T> {
  const headers = new Headers(options.headers);
  headers.set("Content-Type", "application/json");
  if (accessToken) {
    headers.set("Authorization", `Bearer ${accessToken}`);
  }

  const res = await fetch(`${CORE_API_URL}${path}`, {
    ...options,
    headers,
    credentials: "include",
  });

  if (res.status === 401 && !isRetry && path !== "/api/auth/refresh" && path !== "/api/auth/login") {
    const refreshed = await tryRefresh();
    if (refreshed) {
      return request<T>(path, options, true);
    }
    onUnauthorized?.();
    throw new ApiError(401, "Not authenticated");
  }

  const body = await parseBody(res);
  if (!res.ok) {
    const message = (body as { message?: string })?.message ?? `Request failed with status ${res.status}`;
    throw new ApiError(res.status, message);
  }
  return body as T;
}

async function tryRefresh(): Promise<boolean> {
  try {
    const res = await fetch(`${CORE_API_URL}/api/auth/refresh`, {
      method: "POST",
      credentials: "include",
    });
    if (!res.ok) return false;
    const data = (await res.json()) as AuthResponse;
    accessToken = data.accessToken;
    return true;
  } catch {
    return false;
  }
}

export const api = {
  register: (name: string, email: string, password: string) =>
    request<AuthResponse>("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ name, email, password }),
    }),

  login: (email: string, password: string) =>
    request<AuthResponse>("/api/auth/login", { method: "POST", body: JSON.stringify({ email, password }) }),

  refresh: () => request<AuthResponse>("/api/auth/refresh", { method: "POST" }),

  logout: () => request<void>("/api/auth/logout", { method: "POST" }),

  listWorkspaces: () => request<WorkspaceResponse[]>("/api/workspaces"),

  createWorkspace: (name: string) =>
    request<WorkspaceResponse>("/api/workspaces", { method: "POST", body: JSON.stringify({ name }) }),

  inviteMember: (workspaceId: string, email: string, role: "OWNER" | "MEMBER") =>
    request<void>(`/api/workspaces/${workspaceId}/members`, {
      method: "POST",
      body: JSON.stringify({ email, role }),
    }),

  listDocuments: (workspaceId: string) =>
    request<DocumentResponse[]>(`/api/workspaces/${workspaceId}/documents`),

  createDocument: (workspaceId: string, title: string, type: "DOCUMENT" | "WHITEBOARD") =>
    request<DocumentResponse>(`/api/workspaces/${workspaceId}/documents`, {
      method: "POST",
      body: JSON.stringify({ title, type }),
    }),

  getDocument: (documentId: string) => request<DocumentResponse>(`/api/documents/${documentId}`),

  updateDocument: (documentId: string, title: string) =>
    request<DocumentResponse>(`/api/documents/${documentId}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    }),

  shareDocument: (documentId: string, email: string, role: "OWNER" | "EDITOR" | "VIEWER") =>
    request<void>(`/api/documents/${documentId}/share`, {
      method: "POST",
      body: JSON.stringify({ email, role }),
    }),

  collabToken: (documentId: string) =>
    request<CollabTokenResponse>(`/api/documents/${documentId}/collab-token`, { method: "POST" }),

  listVersions: (documentId: string) => request<VersionResponse[]>(`/api/documents/${documentId}/versions`),

  createVersion: (documentId: string, label?: string) =>
    request<VersionResponse>(`/api/documents/${documentId}/versions`, {
      method: "POST",
      body: JSON.stringify({ label: label ?? null }),
    }),

  restoreVersion: (documentId: string, versionId: string) =>
    request<void>(`/api/documents/${documentId}/versions/${versionId}/restore`, { method: "POST" }),
};
