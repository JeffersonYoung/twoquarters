export type FilingItem = { label: string; url?: string };

const hasControl = (text: string) => [...text].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);

export function parseFilingItems(value: unknown, field = 'filingItems'): FilingItem[] {
  if (!value || typeof value !== 'object' || !(field in value)) return [];
  const entries = (value as Record<string, unknown>)[field];
  if (!Array.isArray(entries)) return [];
  return entries.slice(0, 22).flatMap((item: unknown): FilingItem[] => {
    if (!item || typeof item !== 'object' || !('label' in item) || typeof item.label !== 'string') return [];
    const label = item.label.trim();
    if (!label || label.length > 200 || hasControl(label)) return [];
    let url: string | undefined;
    if ('url' in item && item.url != null && item.url !== '') {
      if (typeof item.url !== 'string' || item.url.length > 2048 || !/^https?:\/\/[^/]/i.test(item.url) || (/[\s\\]/u.test(item.url) || hasControl(item.url))) return [{ label }];
      try {
        const parsed = new URL(item.url);
        if (['http:', 'https:'].includes(parsed.protocol) && parsed.hostname && !parsed.username && !parsed.password) url = parsed.href;
      } catch { /* Keep the text, never render an unsafe link. */ }
    }
    return [{ label, ...(url ? { url } : {}) }];
  });
}

export type PublicSiteConfig = { filingItems: FilingItem[]; socialLinks: FilingItem[] };
export async function getSiteConfig(signal?: AbortSignal): Promise<PublicSiteConfig> {
  const empty = { filingItems: [], socialLinks: [] };
  try {
    const response = await fetch('/api/site-config', { credentials: 'same-origin', cache: 'no-store', signal });
    if (!response.ok) return empty;
    const data: unknown = await response.json();
    return { filingItems: parseFilingItems(data), socialLinks: parseFilingItems(data, 'socialLinks').filter(item => item.url) };
  } catch { return empty; }
}
