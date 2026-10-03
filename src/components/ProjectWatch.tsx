import { ArrowLeft, Play } from "lucide-react";
import { useState } from "react";
import type { Project, ProjectVideo } from "../data";
import { imageVariant } from "../lib/images";
import { selectedVideo, videoLink } from "../lib/videos";
import { Link, useLocation } from "../router";

function Player({ video, poster }: { video: ProjectVideo; poster: string }) {
  const [failed, setFailed] = useState(false);
  const ratio = video.width && video.height && video.width > 0 && video.height > 0
    ? `${video.width} / ${video.height}` : "16 / 9";
  return (
    <>
      <video className="watch-player" src={video.src} poster={poster}
        controls playsInline preload="metadata" aria-label={video.name}
        style={{ aspectRatio: ratio }} onError={() => setFailed(true)} onLoadedData={() => setFailed(false)}>
        你的浏览器不支持视频播放。
      </video>
      {failed && <p className="watch-error" role="alert">视频暂时无法播放，请刷新页面重试。</p>}
    </>
  );
}

export function ProjectWatch({ project, videos }: { project: Project; videos: ProjectVideo[] }) {
  const { search } = useLocation();
  const video = selectedVideo(videos, search);
  return (
    <section className="project-watch" aria-label="项目视频">
      <Link className="watch-back" to="/works"><ArrowLeft aria-hidden="true" /> 所有作品</Link>
      {video ? <Player key={video.id} video={video} poster={imageVariant(project.cover.src, 960)} />
        : <p className="watch-error" role="status">暂无可播放视频。</p>}
      <div className="watch-heading">
        <h1>{project.title}</h1>
        {project.titleEn && <p>{project.titleEn}</p>}
      </div>
      {videos.length > 1 && (
        <nav className="watch-selection" aria-label="选择视频">
          {videos.map((item, index) => (
            <Link key={item.id} to={videoLink(project.slug, item.id, search)}
              aria-current={item.id === video.id ? "true" : undefined}
              onClick={(event) => { if (item.id === video.id) event.preventDefault(); }}>
              <Play aria-hidden="true" />
              <span>{String(index + 1).padStart(2, "0")} · {item.name}</span>
            </Link>
          ))}
        </nav>
      )}
    </section>
  );
}
