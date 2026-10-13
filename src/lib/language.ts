type LanguageLocation = { pathname?: string; search?: string; hash?: string };

export function isEnglishLocation(location: LanguageLocation): boolean {
  return location.pathname === "/en" || new URLSearchParams(location.search).get("lang") === "en";
}

export function localizedHref(to: string, english: boolean): string {
  if (!english || !to.startsWith("/") || to.startsWith("//")) return to;
  const url = new URL(to, "https://twoquarters.local");
  if (url.pathname === "/en" || url.pathname.startsWith("/admin") || url.searchParams.has("lang")) return to;
  url.searchParams.set("lang", "en");
  return `${url.pathname}${url.search}${url.hash}`;
}

export function languageSwitchHref(location: LanguageLocation): string {
  const english = isEnglishLocation(location);
  if (location.pathname === "/" || location.pathname === "/en") {
    return `${english ? "/?lang=zh" : "/en"}${location.hash || ""}`;
  }
  const params = new URLSearchParams(location.search);
  params.set("lang", english ? "zh" : "en");
  return `${location.pathname || "/"}?${params}${location.hash || ""}`;
}
