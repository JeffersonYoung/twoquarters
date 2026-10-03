export const selectableCategories = ["automotive", "cg-ai", "fmcg", "video", "bts"] as const;
export type ProjectCategory = typeof selectableCategories[number];

export type ProjectImage = {
  id?: string;
  src: string;
  storagePath?: string;
  alt: string;
  credit?: string;
  width?: number;
  height?: number;
};

export type ProjectVideo = {
  id: string;
  src: string;
  name: string;
  status: "uploading" | "queued" | "processing" | "ready" | "failed";
  error?: string;
  contentType: "video/mp4" | "video/webm";
  width?: number;
  height?: number;
  duration?: number;
  sourceBytes?: number;
  outputBytes?: number;
};

export type Project = {
  id?: string;
  slug: string;
  title: string;
  titleEn: string;
  category: ProjectCategory;
  year: string;
  discipline: string;
  summary: string;
  cover: ProjectImage;
  images: ProjectImage[];
  videos?: ProjectVideo[];
  credits?: string;
  published?: boolean;
};

export const categoryLabels: Record<ProjectCategory, string> = {
  automotive: "汽车",
  "cg-ai": "CG&AI",
  fmcg: "快消",
  video: "视频",
  bts: "幕后影像",
};
