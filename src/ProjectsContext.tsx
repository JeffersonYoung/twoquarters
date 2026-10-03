/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { type Project } from "./data";
import { listPublishedProjects } from "./lib/projects";

type ProjectsContextValue = {
  projects: Project[];
  loading: boolean;
  error: string;
  refresh: () => Promise<void>;
};

const ProjectsContext = createContext<ProjectsContextValue | null>(null);

export function ProjectsProvider({ children }: { children: ReactNode }) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function refresh() {
    try {
      setProjects(await listPublishedProjects());
      setError("");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "作品加载失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    const interval = window.setInterval(() => void refresh(), 50 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, []);

  return <ProjectsContext.Provider value={{ projects, loading, error, refresh }}>{children}</ProjectsContext.Provider>;
}

export function useProjects() {
  const context = useContext(ProjectsContext);
  if (!context) throw new Error("useProjects must be used within ProjectsProvider");
  return context;
}
