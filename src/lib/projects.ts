import type { Project, ProjectImage } from "../data";

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

async function api<T>(path: string, method = "GET", body?: unknown): Promise<T> {
  const form = body instanceof FormData;
  const headers = new Headers();
  if (body !== undefined && !form) headers.set("Content-Type", "application/json");
  if (method !== "GET" && path !== "/login") {
    if (!csrfToken) throw new ApiError("登录已过期，请重新登录后继续", 401);
    headers.set("X-CSRF-Token", csrfToken);
  }
  const response = await fetch(`/api${path}`, {
    method,
    credentials: "same-origin",
    cache: "no-store",
    headers,
    body: body === undefined ? undefined : form ? body as FormData : JSON.stringify(body),
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
export async function login(username: string, password: string) {
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
export const listAdminProjects = () => api<AdminProject[]>("/admin/projects");
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
