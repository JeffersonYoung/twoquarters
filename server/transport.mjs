import { isIP } from 'node:net';

// Exact socket peer allowlist, never an arbitrary forwarding chain or subnet.
const normalizeIP = value => value.startsWith('::ffff:') && isIP(value.slice(7)) === 4 ? value.slice(7) : value;
export function transportPolicy(origin, trustedProxyIPs = '') {
 const url = new URL(origin);
 const trusted = new Set(trustedProxyIPs.split(',').map(x => x.trim()).filter(Boolean).map(ip => {
  if (!isIP(ip)) throw new Error('TRUSTED_PROXY_IPS must contain only exact IP addresses');
  return normalizeIP(ip);
 }));
 return req => {
  if (req.headers.host !== url.host) return false;
  if (req.socket.encrypted === true) return true;
  // The trusted proxy MUST overwrite this header from its actual connection scheme.
  return trusted.has(normalizeIP(req.socket.remoteAddress || '')) && req.headers['x-forwarded-proto'] === 'https';
 };
}
