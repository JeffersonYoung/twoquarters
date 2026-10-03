export type ProjectCategory = "automotive" | "fashion" | "bts";

export type ProjectImage = {
  id?: string;
  src: string;
  storagePath?: string;
  alt: string;
  credit?: string;
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
  credits?: string;
  published?: boolean;
};

export const categoryLabels: Record<ProjectCategory, string> = {
  automotive: "汽车与 CGI",
  fashion: "时尚与美妆",
  bts: "幕后影像",
};

