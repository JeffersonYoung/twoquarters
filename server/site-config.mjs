import { open } from 'node:fs/promises';

const invalid = () => { throw new Error('Invalid site config; check filing fields and HTTP(S) links.'); };
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function text(value, max) {
  if (value == null) return '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) invalid();
  return value.trim();
}
function entry(value, field) {
  if (value == null) return null;
  if (!object(value)) invalid();
  const label = text(value[field], 200), raw = text(value.url, 2048);
  let url;
  if (raw) {
    // Require an explicit absolute HTTP(S) URL; reject browser normalization tricks.
    if (!/^https?:\/\/[^/]/i.test(raw) || /[\s\\]/u.test(raw)) invalid();
    try {
      const parsed = new URL(raw);
      if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname || parsed.username || parsed.password) invalid();
      url = parsed.href;
    } catch { invalid(); }
  }
  return label ? { label, ...(url ? { url } : {}) } : null;
}

// Explicit allowlist: never serialize the source object or arbitrary extra keys.
export function publicSiteConfig(value) {
  if (!object(value)) invalid();
  const filing = value.filing ?? {};
  if (!object(filing)) invalid();
  const other = filing.other ?? [];
  if (!Array.isArray(other) || other.length > 20) invalid();
  const social = value.socialLinks ?? [];
  if (!Array.isArray(social) || social.length > 20) invalid();
  return {
    filingItems: [entry(filing.icp, 'number'), entry(filing.publicSecurity, 'number'), ...other.map(item => entry(item, 'label'))].filter(Boolean),
    socialLinks: social.map(item => entry(item, 'label')).filter(item => item?.url),
  };
}

// Read once on startup. No configured file means no filing text. A bad explicit
// configuration fails startup, so a production compliance typo is not silent.
export async function loadSiteConfig(filename = process.env.SITE_CONFIG_FILE) {
  if (!filename) return { filingItems: [], socialLinks: [] };
  let file;
  try {
    file = await open(filename, 'r');
    const info = await file.stat();
    if (!info.isFile() || info.size > 64 * 1024) invalid();
    const buffer = Buffer.alloc(64 * 1024 + 1);
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, null);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > 64 * 1024) invalid();
    return publicSiteConfig(JSON.parse(buffer.subarray(0, size).toString('utf8')));
  } catch {
    // Neither OS errors nor the configured path/content should reach logs/API.
    throw new Error('Cannot load site config; check file readability, JSON syntax and filing fields.');
  } finally { await file?.close(); }
}
