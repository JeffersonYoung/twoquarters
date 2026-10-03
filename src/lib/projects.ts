import type { Project, ProjectImage, ProjectVideo } from "../data";

export type AdminProject = Omit<Project, "cover"> & {
  id: string;
  cover: ProjectImage | null;
  published: boolean;
};
export type ProjectDraft = Pick<AdminProject, "title" | "titleEn" | "category" | "year" | "discipline" | "summary" | "credits" | "published">;
export type AdminSession = { admin: boolean; csrfToken: string | null };

// Keep the anti-CSRF token in memory. The session itself stays in an HttpOnly cookie.
let csrfToken: string | null = null;
let sessionVersion = 0;

export class ApiError extends Error {
  constructor(message: string, public readonly status: number) {
    super(message);
    this.name = "ApiError";
  }
}

async function api<T>(path: string, method = "GET", body?: unknown, signal?: AbortSignal, extraHeaders?: HeadersInit): Promise<T> {
  const form = body instanceof FormData;
  const file = body instanceof File;
  const headers = new Headers(extraHeaders);
  if (body !== undefined && !form && !file) headers.set("Content-Type", "application/json");
  if (file) {
    headers.set("Content-Type", body.type || "application/octet-stream");
    headers.set("X-Upload-Name", encodeURIComponent(body.name));
  }
  if (method !== "GET" && path !== "/login") {
    if (!csrfToken) throw new ApiError("登录已过期，请重新登录后继续", 401);
    headers.set("X-CSRF-Token", csrfToken);
  }
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers,
    signal,
    body: body === undefined ? undefined : (form || file) ? body as FormData | File : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if (response.status === 401) csrfToken = null;
    throw new ApiError(data?.error || "请求失败，请稍后重试", response.status);
  }
  return data as T;
}

function acceptSession(session: AdminSession): AdminSession {
  csrfToken = session.admin ? session.csrfToken : null;
  return session;
}

export async function getSession() {
  const version = ++sessionVersion;
  const session = await api<AdminSession>("/session");
  return version === sessionVersion ? acceptSession(session) : session;
}
// Local HTTP is for development only; production transport is enforced again by the server.
export function adminTransportAllowed() {
  return typeof window === "undefined" || window.location.protocol === "https:" ||
    ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
}
export async function login(username: string, password: string) {
  if (!adminTransportAllowed()) throw new ApiError("请使用已配置的 HTTPS 管理地址登录", 403);
  const version = ++sessionVersion;
  const session = await api<AdminSession>("/login", "POST", { username, password });
  return version === sessionVersion ? acceptSession(session) : session;
}
export async function logout() {
  await api("/logout", "POST");
  sessionVersion += 1;
  csrfToken = null;
}

export const listPublishedProjects = () => api<Project[]>("/projects");
export const listAdminProjects = (signal?: AbortSignal) => api<AdminProject[]>("/admin/projects", "GET", undefined, signal);
export const createProject = (draft: ProjectDraft) => api<{ slug: string }>("/admin/projects", "POST", draft);
export const updateProject = (id: string, draft: ProjectDraft) => api(`/admin/projects/${encodeURIComponent(id)}`, "PATCH", draft);
export const setProjectCover = (project: AdminProject, imageId: string) =>
  api(`/admin/projects/${encodeURIComponent(project.id)}/cover`, "POST", { imageId });
export async function uploadProjectImages(project: AdminProject, files: File[]) {
  const form = new FormData();
  for (const file of files) form.append("images", file);
  return api(`/admin/projects/${encodeURIComponent(project.id)}/images`, "POST", form);
}
export const deleteProjectImage = (project: AdminProject, image: ProjectImage) =>
  api(`/admin/projects/${encodeURIComponent(project.id)}/images/${encodeURIComponent(image.id || "")}`, "DELETE");
export const deleteProject = (project: AdminProject) => api(`/admin/projects/${encodeURIComponent(project.id)}`, "DELETE");

export type VideoCompressionMode = "server" | "browser";
export const uploadProjectVideo = (project: AdminProject, file: File, mode: VideoCompressionMode = "server", signal?: AbortSignal) =>
  api<AdminProject>(`/admin/projects/${encodeURIComponent(project.id)}/videos`, "POST", file, signal, { "X-Video-Compression": mode });
export const deleteProjectVideo = (project: AdminProject, video: ProjectVideo) =>
  api<AdminProject>(`/admin/projects/${encodeURIComponent(project.id)}/videos/${encodeURIComponent(video.id)}`, "DELETE");

export type StorageOverview = {
  sampledAt: string;
  filesystem: { totalBytes: number; usedBytes: number; availableBytes: number; reservedBytes: number };
  managedFiles: { allocatedBytes: number; logicalBytes: number } | null;
  video: { reserveBytes: number; maxFileBytes: number; activeJobs: number; requiredBytes: number; availableBytes: number; hasSpaceForNextUpload: boolean };
};
export const getStorageOverview = (signal?: AbortSignal) => api<StorageOverview>("/admin/storage", "GET", undefined, signal);
