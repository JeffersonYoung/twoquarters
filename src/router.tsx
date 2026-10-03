/* eslint-disable react-refresh/only-export-components */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type ReactNode,
} from "react";

type LocationState = {
  pathname: string;
  search: string;
  hash: string;
};

type RouterValue = LocationState & {
  navigate: (to: string, replace?: boolean) => void;
};

const RouterContext = createContext<RouterValue | null>(null);

function currentLocation(): LocationState {
  return {
    pathname: window.location.pathname,
    search: window.location.search,
    hash: window.location.hash,
  };
}

export function RouterProvider({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(currentLocation);

  useEffect(() => {
    const update = () => setLocation(currentLocation());
    window.addEventListener("popstate", update);
    window.addEventListener("hashchange", update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("hashchange", update);
    };
  }, []);

  const navigate = useCallback((to: string, replace = false) => {
    const url = new URL(to, window.location.href);
    if (url.origin !== window.location.origin) {
      window.location.assign(url);
      return;
    }
    window.history[replace ? "replaceState" : "pushState"]({}, "", `${url.pathname}${url.search}${url.hash}`);
    setLocation(currentLocation());
  }, []);

  const value = useMemo(() => ({ ...location, navigate }), [location, navigate]);
  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>;
}

export function useLocation() {
  const context = useContext(RouterContext);
  if (!context) throw new Error("useLocation must be used within RouterProvider");
  return context;
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & { to: string };

export function Link({ to, onClick, children, ...props }: LinkProps) {
  const { navigate } = useLocation();

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    onClick?.(event);
    if (
      event.defaultPrevented ||
      event.button !== 0 ||
      event.metaKey ||
      event.ctrlKey ||
      event.shiftKey ||
      event.altKey ||
      props.target === "_blank"
    ) return;
    event.preventDefault();
    navigate(to);
  }

  return <a {...props} href={to} onClick={handleClick}>{children}</a>;
}

export function NavLink({ to, end = false, className = "", ...props }: LinkProps & { end?: boolean }) {
  const { pathname } = useLocation();
  const active = end ? pathname === to : pathname === to || pathname.startsWith(`${to}/`);
  return <Link {...props} to={to} className={`${className} ${active ? "active" : ""}`.trim()} />;
}

export function Navigate({ to, replace = true }: { to: string; replace?: boolean }) {
  const { navigate } = useLocation();
  useEffect(() => navigate(to, replace), [navigate, replace, to]);
  return null;
}

export function useParams() {
  const { pathname } = useLocation();
  const match = pathname.match(/^\/works\/([^/]+)$/);
  return { slug: match ? decodeURIComponent(match[1]) : undefined };
}
