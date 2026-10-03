import { StorageOverview } from "../components/StorageOverview";
import {
  ArrowUpRight,
  AlertCircle,
  Check,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Loader2,
  LogOut,
  LogIn,
  Menu,
  Plus,
  Save,
  Star,
  Trash2,
  UploadCloud,
  Video,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type FormEvent } from "react";
import { categoryLabels, selectableCategories, type ProjectCategory, type ProjectImage, type ProjectVideo } from "../data";
import {
  createProject,
  deleteProject as removeProject,
  deleteProjectImage,
  ApiError,
  getSession,
  login,
  logout as endSession,
  listAdminProjects,
  setProjectCover,
  updateProject,
  uploadProjectImages,
  uploadProjectVideo,
  deleteProjectVideo,
  type AdminProject,
  type ProjectDraft,
} from "../lib/projects";
import { Link } from "../router";
import { imageVariant } from "../lib/images";
import { useProjects } from "../ProjectsContext";

const emptyDraft: ProjectDraft = {
  title: "",
  titleEn: "",
  category: "automotive",
  year: String(new Date().getFullYear()),
  discipline: "Photography",
  summary: "",
  credits: "",
  published: false,
};

type EditorState = {
  selectedSlug: string | null;
  draft: ProjectDraft;
  savedDraft: ProjectDraft;
  creating: boolean;
};

function projectDraft(project: AdminProject): ProjectDraft {
  return {
    title: project.title,
    titleEn: project.titleEn,
    category: project.category,
    year: project.year,
    discipline: project.discipline,
    summary: project.summary,
    credits: project.credits || "",
    published: project.published,
  };
}

function editorFor(project: AdminProject | null): EditorState {
  const draft = project ? projectDraft(project) : { ...emptyDraft };
  return { selectedSlug: project?.slug || null, draft, savedDraft: draft, creating: false };
}

export function AdminPage() {
  const { refresh: refreshPublishedProjects } = useProjects();
  const [session, setSession] = useState<"checking" | "guest" | "authenticated">("checking");
  const [loginError, setLoginError] = useState("");
  const [projects, setProjects] = useState<AdminProject[]>([]);
  const [editor, setEditor] = useState<EditorState>(() => editorFor(null));
  const { selectedSlug, draft, creating } = editor;
  const [busy, setBusy] = useState(false);
  const [projectsLoading, setProjectsLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [dragging, setDragging] = useState(false);
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const [videoPollError, setVideoPollError] = useState("");
  const publicRefresh = useRef(refreshPublishedProjects);
  useEffect(() => { publicRefresh.current = refreshPublishedProjects; }, [refreshPublishedProjects]);
  const inputRef = useRef<HTMLInputElement>(null);
  const operation = useRef(false);
  const loadSequence = useRef(0);
  const dirty = JSON.stringify(draft) !== JSON.stringify(editor.savedDraft);
  const locked = busy || projectsLoading;

  const selected = useMemo(
    () => projects.find((project) => project.slug === selectedSlug) || null,
    [projects, selectedSlug],
  );

  const showError = useCallback((error: unknown, fallback: string) => {
    if (error instanceof ApiError && error.status === 401) {
      setLoginError("登录已过期，请重新登录。未保存的项目资料会保留在当前页面。");
      setSession("guest");
    } else {
      setNotice({ text: error instanceof Error ? error.message : fallback, error: true });
    }
  }, []);

  const loadProjects = useCallback(async (preferredSlug?: string | null, resetDraft = false) => {
    const sequence = ++loadSequence.current;
    setProjectsLoading(true);
    try {
      const loaded = await listAdminProjects();
      if (sequence !== loadSequence.current) return;
      setProjects(loaded);
      setLoadError("");
      setEditor((current) => {
        // A background refresh or renewed login must not discard an in-progress draft.
        if (preferredSlug === undefined && current.creating && !resetDraft) return current;
        const slug = preferredSlug === undefined ? current.selectedSlug : preferredSlug;
        const next = loaded.find((project) => project.slug === slug) || loaded[0] || null;
        if (!resetDraft && next && next.slug === current.selectedSlug) {
          return next.cover ? current : {
            ...current,
            draft: { ...current.draft, published: false },
            savedDraft: { ...current.savedDraft, published: false },
          };
        }
        return editorFor(next);
      });
    } catch (error) {
      if (sequence !== loadSequence.current) return;
      setLoadError(error instanceof Error ? error.message : "项目加载失败");
      showError(error, "项目加载失败");
    } finally {
      if (sequence === loadSequence.current) setProjectsLoading(false);
    }
  }, [showError]);

  useEffect(() => {
    let active = true;
    getSession().then(({ admin }) => {
      if (active) setSession(admin ? "authenticated" : "guest");
    }).catch((error: unknown) => {
      if (active) {
        setLoginError(error instanceof Error ? error.message : "无法检查登录状态，请重试");
        setSession("guest");
      }
    });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (session === "authenticated") void loadProjects();
    return () => { loadSequence.current += 1; };
  }, [session, loadProjects]);

  const pendingVideos = projects.flatMap((project) => (project.videos || [])
    .filter((video) => video.status === "uploading" || video.status === "queued" || video.status === "processing")
    .map((video) => `${video.id}:${video.status}`)).join(",");

  useEffect(() => {
    if (session !== "authenticated" || !pendingVideos) return;
    let active = true;
    let timer: number;
    const controller = new AbortController();
    async function poll() {
      if (!active) return;
      if (operation.current) { timer = window.setTimeout(() => void poll(), 2000); return; }
      const sequence = loadSequence.current;
      try {
        const loaded = await listAdminProjects(controller.signal);
        if (!active || operation.current || sequence !== loadSequence.current) return;
        // Only merge video state: polling never replaces unsaved editor fields.
        setProjects((current) => current.map((project) => {
          const latest = loaded.find((item) => item.id === project.id);
          return latest ? { ...project, videos: latest.videos } : project;
        }));
        setVideoPollError("");
        const finished = loaded.some((project) => project.videos?.some((video) =>
          (video.status === "ready" || video.status === "failed") && pendingVideos.includes(`${video.id}:`)));
        if (finished) void publicRefresh.current();
      } catch (error) {
        if (!active) return;
        if (error instanceof ApiError && error.status === 401) showError(error, "登录已过期");
        else setVideoPollError("暂时无法更新视频状态，正在自动重试。");
      } finally {
        if (active) timer = window.setTimeout(() => void poll(), 2500);
      }
    }
    timer = window.setTimeout(() => void poll(), 2000);
    return () => { active = false; window.clearTimeout(timer); controller.abort(); };
  }, [session, pendingVideos, selectedSlug, showError]);

  useEffect(() => {
    if (!dirty && !busy) return;
    const warnBeforeLeaving = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warnBeforeLeaving);
    return () => window.removeEventListener("beforeunload", warnBeforeLeaving);
  }, [dirty, busy]);

  useEffect(() => {
    if (!sidebarOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSidebarOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [sidebarOpen]);

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (operation.current) return;
    const form = event.currentTarget;
    const fields = new FormData(form);
    operation.current = true;
    setBusy(true);
    setLoginError("");
    try {
      const result = await login(String(fields.get("username") || "").trim(), String(fields.get("password") || ""));
      if (!result.admin || !result.csrfToken) throw new Error("登录失败，请检查账号和密码");
      form.reset();
      setNotice(null);
      setSession("authenticated");
    } catch (error) {
      setLoginError(error instanceof Error ? error.message : "登录失败，请稍后重试");
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }

  function canLeaveDraft() {
    return !operation.current && !projectsLoading && (!dirty || window.confirm("项目资料尚未保存，确定放弃这些修改？"));
  }

  async function logout() {
    if (!canLeaveDraft()) return;
    operation.current = true;
    setBusy(true);
    try {
      try {
        await endSession();
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 401) throw error;
      }
      setSession("guest");
      setProjects([]);
      setEditor(editorFor(null));
      setNotice(null);
      setLoginError("");
      setSidebarOpen(false);
    } catch (error) {
      showError(error, "退出失败，请重试");
    } finally {
      operation.current = false;
      setBusy(false);
    }
  }

  function updateDraft<K extends keyof ProjectDraft>(key: K, value: ProjectDraft[K]) {
    setEditor((current) => ({ ...current, draft: { ...current.draft, [key]: value } }));
  }

  function selectProject(project: AdminProject) {
    if (project.slug === selectedSlug) { setSidebarOpen(false); return; }
    if (!canLeaveDraft()) return;
    setEditor(editorFor(project));
    setNotice(null);
    setSidebarOpen(false);
  }

  function startCreate() {
    if (!canLeaveDraft()) return;
    setEditor({ ...editorFor(null), creating: true });
    setNotice(null);
    setSidebarOpen(false);
  }

  function cancelCreate() {
    if (!canLeaveDraft()) return;
    setEditor(editorFor(projects[0] || null));
  }

  async function runAction(action: () => Promise<void>, success: string) {
    // The ref also blocks a second click/drop before React renders disabled buttons.
    if (operation.current || projectsLoading) return;
    operation.current = true;
    setBusy(true);
    setNotice(null);
    try {
      await action();
      await refreshPublishedProjects();
      setNotice({ text: success });
    } catch (error) {
      showError(error, "操作失败，请重试");
    } finally {
      operation.current = false;
      setBusy(false);
      setDragging(false);
    }
  }

  async function saveProject(event: FormEvent) {
    event.preventDefault();
    if (!creating && !selected) return;
    const saved = { ...draft };
    await runAction(async () => {
      if (creating) {
        const created = await createProject(saved);
        // Mark creation complete before refreshing, so a failed refresh cannot duplicate it.
        setEditor({ selectedSlug: created.slug, creating: false, draft: saved, savedDraft: saved });
        await loadProjects(created.slug, true);
      } else if (selected) {
        await updateProject(selected.id, saved);
        setEditor((current) => ({ ...current, savedDraft: saved }));
        await loadProjects(selected.slug, true);
      }
    }, creating ? "项目已创建，可以上传图片" : "项目资料已保存");
  }

  async function uploadFiles(files: FileList | File[]) {
    const incoming = [...files];
    if (!selected || !incoming.length || locked || operation.current) { setDragging(false); return; }
    if (incoming.length > 10 || incoming.reduce((total, file) => total + file.size, 0) > 60 * 1024 * 1024) {
      setNotice({ text: "每次最多上传 10 张图片，且合计不超过 60MB", error: true });
      setDragging(false);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    const supported = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);
    if (incoming.some((file) => !supported.has(file.type) || file.size > 12 * 1024 * 1024)) {
      setNotice({ text: "请选择 JPG、PNG、WebP 或 GIF 图片，且单张不超过 12MB", error: true });
      setDragging(false);
      if (inputRef.current) inputRef.current.value = "";
      return;
    }
    await runAction(async () => {
      await uploadProjectImages(selected, incoming);
      await loadProjects(selected.slug);
    }, `已上传 ${incoming.length} 张图片`);
    if (inputRef.current) inputRef.current.value = "";
  }

  async function uploadVideo(file?: File) {
    if (!selected || !file || locked || operation.current) return;
    const types = ["video/mp4", "video/quicktime", "video/webm"];
    if (!types.includes(file.type) || file.size === 0 || file.size > 250 * 1024 * 1024) {
      setNotice({ text: "请选择 MP4、MOV 或 WebM 视频，单个文件最大 250MiB，且不能为空", error: true });
      if (videoInputRef.current) videoInputRef.current.value = "";
      return;
    }
    await runAction(async () => {
      await uploadProjectVideo(selected, file);
      await loadProjects(selected.slug);
    }, "视频已上传，正在后台压缩。可以继续编辑项目资料。");
    if (videoInputRef.current) videoInputRef.current.value = "";
  }

  async function deleteVideo(video: ProjectVideo) {
    if (!selected || locked || operation.current || !window.confirm(`确定删除视频“${video.name}”？压缩版本和处理记录都会被删除。`)) return;
    await runAction(async () => {
      await deleteProjectVideo(selected, video);
      await loadProjects(selected.slug);
    }, "视频已删除");
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    void uploadFiles(event.dataTransfer.files);
  }

  function handleFileInput(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) void uploadFiles(event.target.files);
  }

  async function setCover(imageId?: string) {
    if (!selected || !imageId) return;
    await runAction(async () => {
      await setProjectCover(selected, imageId);
      await loadProjects(selected.slug);
    }, "封面已更新");
  }

  async function deleteImage(image: ProjectImage) {
    if (!selected || !image.id || locked || operation.current || !window.confirm("确定删除这张图片？")) return;
    await runAction(async () => {
      await deleteProjectImage(selected, image);
      await loadProjects(selected.slug);
    }, "图片已删除");
  }

  async function deleteProject() {
    if (!selected || locked || operation.current || !window.confirm(`确定删除项目“${selected.title}”？上传的图片和视频也会被删除。`)) return;
    await runAction(async () => {
      await removeProject(selected);
      setEditor(editorFor(null));
      setProjects((current) => current.filter((project) => project.id !== selected.id));
      await loadProjects(null, true);
    }, "项目已删除");
  }

  if (session === "checking") {
    return <main className="admin-loading"><Loader2 className="spin" aria-hidden="true" /><span>正在检查登录状态</span></main>;
  }

  if (session === "guest") {
    return (
      <main className="admin-login">
        <Link className="admin-brand" to="/">TWOQUARTERS</Link>
        <form onSubmit={signIn} aria-busy={busy}>
          <span className="admin-eyebrow">Content administration</span>
          <h1>管理后台</h1>
          <p>使用本站管理员账号登录，管理作品、封面、图片和视频。</p>
          <label htmlFor="admin-username">用户名</label>
          <div className="login-field username-field">
            <input id="admin-username" name="username" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={80} disabled={busy} />
          </div>
          <label htmlFor="admin-password">密码</label>
          <div className="login-field">
            <input id="admin-password" name="password" type="password" autoComplete="current-password" maxLength={1024} required disabled={busy} />
            <button type="submit" disabled={busy} aria-label="登录">{busy ? <Loader2 className="spin" aria-hidden="true" /> : <LogIn aria-hidden="true" />}</button>
          </div>
          {loginError && <div className="admin-error" role="alert">{loginError}</div>}
          <small>账号由网站管理员在服务器上配置。</small>
        </form>
      </main>
    );
  }

  return (
    <main className="admin-shell">
      <header className="admin-topbar">
        <button className="admin-mobile-menu" type="button" onClick={() => setSidebarOpen(true)} aria-label="打开项目列表">
          <Menu aria-hidden="true" />
        </button>
        <span className="admin-brand">TWOQUARTERS <i>ADMIN</i></span>
        <div>
          <Link to="/" target="_blank">查看网站 <ArrowUpRight aria-hidden="true" /></Link>
          <button type="button" onClick={() => void logout()} disabled={locked}><LogOut aria-hidden="true" /> 退出</button>
        </div>
      </header>

      {sidebarOpen && <button className="admin-sidebar-backdrop" type="button" aria-label="关闭项目列表" onClick={() => setSidebarOpen(false)} />}
      <aside className={`admin-sidebar ${sidebarOpen ? "is-open" : ""}`}>
        <div className="sidebar-heading">
          <span>项目</span>
          <button type="button" onClick={() => setSidebarOpen(false)} aria-label="关闭项目列表"><X aria-hidden="true" /></button>
        </div>
        <button className="new-project-button" type="button" onClick={startCreate} disabled={locked}><Plus aria-hidden="true" /> 新建项目</button>
        <nav aria-label="项目列表">
          {projects.map((project) => (
            <button
              key={project.slug}
              className={project.slug === selectedSlug ? "active" : ""}
              type="button"
              disabled={locked}
              onClick={() => selectProject(project)}
            >
              <span>{project.title}</span>
              <small>{project.images.length} 张</small>
              <i className={project.published ? "published" : "draft"}>{project.published ? "已发布" : "草稿"}</i>
            </button>
          ))}
        </nav>
      </aside>

      <section className="admin-workspace" aria-busy={locked}>
        <StorageOverview onAuthError={showError} />
        {loadError && <div className="admin-load-error" role="alert">{loadError} <button type="button" disabled={locked} onClick={() => void loadProjects()}>重新加载项目</button></div>}
        {projectsLoading && !projects.length && <p className="admin-empty-state" role="status">正在加载项目…</p>}
        {!projectsLoading && !loadError && !projects.length && !creating && <p className="admin-empty-state">还没有项目。点击“新建项目”添加第一个作品。</p>}
        <div className="workspace-heading">
          <div>
            <span>{creating ? "New project" : selected?.slug || "Project library"}</span>
            <h1>{creating ? "创建项目" : selected?.title || "选择一个项目"}</h1>
          </div>
          {selected && (
            <span className={`publish-state ${selected.published ? "published" : "draft"}`}>
              {selected.published ? <Eye aria-hidden="true" /> : <EyeOff aria-hidden="true" />}
              {selected.published ? "公开展示" : "未发布"}
            </span>
          )}
        </div>

        {(creating || selected) && (
          <form className="project-editor" onSubmit={saveProject}>
            <div className="editor-section-heading"><span>01</span><h2>项目资料</h2></div>
            <fieldset className="editor-fields" disabled={locked}>
              <label>中文标题<input value={draft.title} required onChange={(event) => updateDraft("title", event.target.value)} /></label>
              <label>英文标题<input value={draft.titleEn} required onChange={(event) => updateDraft("titleEn", event.target.value)} /></label>
              <label>分类
                <select value={draft.category} onChange={(event) => updateDraft("category", event.target.value as ProjectCategory)}>
                  {selectableCategories.map(category => <option key={category} value={category}>{categoryLabels[category]}</option>)}
                </select>
              </label>
              <label>年份<input value={draft.year} required maxLength={8} onChange={(event) => updateDraft("year", event.target.value)} /></label>
              <label className="wide">服务内容<input value={draft.discipline} required onChange={(event) => updateDraft("discipline", event.target.value)} /></label>
              <label className="wide">项目简介<textarea rows={4} value={draft.summary} onChange={(event) => updateDraft("summary", event.target.value)} /></label>
              <label className="wide">项目署名<input value={draft.credits} onChange={(event) => updateDraft("credits", event.target.value)} /></label>
              <label className="publish-toggle">
                <input
                  type="checkbox"
                  checked={draft.published}
                  disabled={creating || !selected?.cover}
                  onChange={(event) => updateDraft("published", event.target.checked)}
                />
                <span><Check aria-hidden="true" /></span>
                允许在公开网站展示
              </label>
            </fieldset>
            <div className="editor-actions">
              {!creating && <button className="danger-button" type="button" onClick={() => void deleteProject()} disabled={locked}><Trash2 aria-hidden="true" /> 删除项目</button>}
              {creating && <button className="danger-button" type="button" onClick={cancelCreate} disabled={locked}>取消</button>}
              <button className="primary-button" type="submit" disabled={locked}>
                {busy ? <Loader2 className="spin" aria-hidden="true" /> : <Save aria-hidden="true" />}
                {creating ? "创建并继续" : "保存资料"}
              </button>
            </div>
          </form>
        )}

        {selected && (
          <section className="image-manager">
            <div className="editor-section-heading"><span>02</span><h2>项目图片</h2><em>{selected.images.length} 张</em></div>
            <div
              className={`upload-zone ${dragging ? "is-dragging" : ""}`}
              onDragEnter={(event) => { event.preventDefault(); if (!locked) setDragging(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragging(false)}
              onDrop={handleDrop}
            >
              <UploadCloud aria-hidden="true" />
              <div><strong>拖放图片到这里</strong><span>JPG、PNG、WebP、GIF；单张 12MB，每次最多 10 张 / 60MB</span></div>
              <button type="button" onClick={() => inputRef.current?.click()} disabled={locked}>选择图片</button>
              <input ref={inputRef} type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif" onChange={handleFileInput} />
            </div>

            {selected.images.length ? (
              <div className="admin-image-grid">
                {selected.images.map((image, index) => {
                  const isCover = selected.cover?.id === image.id || selected.cover?.src === image.src;
                  return (
                    <article key={image.id || image.src}>
                      <figure><img src={imageVariant(image.src, 480)} alt={image.alt} loading="lazy" decoding="async" /></figure>
                      <div className="image-card-info">
                        <span>{String(index + 1).padStart(2, "0")}</span>
                        <p title={image.alt}>{image.alt}</p>
                        {isCover && <em><Star aria-hidden="true" /> 封面</em>}
                      </div>
                      <div className="image-card-actions">
                        <button type="button" disabled={isCover || locked} onClick={() => void setCover(image.id)} title="设为封面"><Star aria-hidden="true" /></button>
                        <button type="button" disabled={locked} onClick={() => void deleteImage(image)} title="删除图片"><Trash2 aria-hidden="true" /></button>
                      </div>
                    </article>
                  );
                })}
              </div>
            ) : (
              <div className="empty-library"><ImageIcon aria-hidden="true" /><h3>还没有图片</h3><p>上传第一张图片后即可设置封面并发布项目。</p></div>
            )}
          </section>
        )}
        {selected && (
          <section className="video-manager" aria-labelledby="video-manager-title">
            <div className="editor-section-heading"><span>03</span><h2 id="video-manager-title">项目视频</h2><em>{selected.videos?.length || 0} 个</em></div>
            <div className="upload-zone">
              <Video aria-hidden="true" />
              <div><strong>上传视频，自动压缩</strong><span>MP4、MOV、WebM；单个文件最大 250MiB</span></div>
              <button type="button" onClick={() => videoInputRef.current?.click()} disabled={locked}>选择视频</button>
              <input ref={videoInputRef} type="file" accept="video/mp4,video/quicktime,video/webm" disabled={locked} onChange={(event) => void uploadVideo(event.target.files?.[0])} />
            </div>
            <p className="video-help">在本站服务器本地转码为 H.264 / AAC MP4，CRF 22；横屏最高 1920 × 1080，竖屏最高 1080 × 1920，不放大小尺寸视频。临时原始文件在处理成功或失败后都会删除，仅保留压缩完成的视频；失败后需重新上传。公开页面仅展示压缩完成的视频。发布项目仍需图片封面。</p>
            {videoPollError && pendingVideos && <p className="video-poll-error" role="status">{videoPollError}</p>}
            {selected.videos?.length ? (
              <div className="admin-video-grid">
                {selected.videos.map((video) => (
                  <article key={video.id}>
                    {video.status === "ready" ? <video src={video.src} controls playsInline preload="metadata" aria-label={video.name} /> : (
                      <div className="video-placeholder">{video.status === "failed" ? <AlertCircle aria-hidden="true" /> : <Loader2 className="spin" aria-hidden="true" />}<span>{video.status === "failed" ? "压缩失败" : video.status === "uploading" ? "正在上传" : video.status === "queued" ? "等待压缩" : "正在压缩"}</span></div>
                    )}
                    <div className="video-card-info">
                      <h3 title={video.name}>{video.name}</h3>
                      <p className={`video-status video-status-${video.status}`} role="status">{video.status === "ready" ? "已就绪" : video.status === "failed" ? "处理失败" : video.status === "uploading" ? "正在上传" : video.status === "queued" ? "已排队 · 可以继续编辑" : "处理中 · 可以继续编辑"}</p>
                      {video.status === "failed" && <p className="video-error">{video.error || "视频压缩失败。"} 原始文件已清理，请删除此记录后重新上传。</p>}
                      {video.status === "ready" && <p className="video-details">{video.width && video.height ? `${video.width} × ${video.height}` : "MP4"}{video.duration ? ` · ${Math.round(video.duration)} 秒` : ""}{video.outputBytes ? ` · ${(video.outputBytes / 1024 / 1024).toFixed(1)} MiB` : ""}</p>}
                      <div className="video-card-actions">
                        <button type="button" disabled={locked} onClick={() => void deleteVideo(video)} aria-label={`删除视频 ${video.name}`}><Trash2 aria-hidden="true" /> 删除</button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            ) : <div className="empty-library"><Video aria-hidden="true" /><h3>还没有视频</h3><p>视频为可选内容，上传后会自动压缩并显示在项目详情页。</p></div>}
          </section>
        )}
      </section>

      {busy && <div className="admin-busy" aria-label="处理中"><Loader2 className="spin" aria-hidden="true" /></div>}
      {notice && <div className={`admin-notice ${notice.error ? "is-error" : ""}`} role={notice.error ? "alert" : "status"}>
        {notice.error ? <AlertCircle aria-hidden="true" /> : <Check aria-hidden="true" />}
        {notice.text}
        <button type="button" aria-label="关闭提示" onClick={() => setNotice(null)}><X aria-hidden="true" /></button>
      </div>}
    </main>
  );
}
