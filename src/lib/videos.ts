import type { Project, ProjectVideo } from "../data";

export function videoSource(video: ProjectVideo) {
  const expected = `https://img.twoquarters.com.cn/api/videos/${video.id}`;
  return video.cdnSrc === expected ? expected : video.src;
}

// Selection is only an ID lookup in this published project's API response. Never
// turn a query string into a media URL or fetch another project's video by ID.
export function playableVideos(project: Project): ProjectVideo[] {
  if (project.published === false) return [];
  return (project.videos || []).filter((video) => video.status === "ready" &&
    /^[a-f0-9-]{36}$/.test(video.id) && video.src === `/api/videos/${video.id}`);
}

export function selectedVideo(videos: ProjectVideo[], search: string) {
  const id = new URLSearchParams(search).get("video");
  return videos.find((video) => video.id === id) || videos[0];
}

export function videoLink(slug: string, id: string, search = "") {
  const params = new URLSearchParams(search);
  params.set("video", id);
  return `/works/${encodeURIComponent(slug)}?${params}`;
}
