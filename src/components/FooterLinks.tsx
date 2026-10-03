import { ArrowUpRight } from 'lucide-react';
import type { FilingItem } from '../lib/site-config';

export function SocialLinks({ items, isEnglish }: { items: FilingItem[]; isEnglish: boolean }) {
  if (!items.length) return null;
  return (
    <nav aria-label={isEnglish ? 'Social media' : '社交媒体'}>
      <ul className="footer-socials">
        {items.map((item, index) => (
          <li key={index}><a href={item.url} target="_blank" rel="noopener noreferrer">{item.label}<ArrowUpRight aria-hidden="true" /></a></li>
        ))}
      </ul>
    </nav>
  );
}

export function FilingLinks({ items, isEnglish }: { items: FilingItem[]; isEnglish: boolean }) {
  if (!items.length) return null;
  return (
    <ul className="footer-filings" aria-label={isEnglish ? 'Site registration' : '网站备案信息'}>
      {items.map((item, index) => (
        <li key={index}>
          {item.url ? <a href={item.url} target="_blank" rel="noopener noreferrer">{item.label}</a> : <span>{item.label}</span>}
        </li>
      ))}
    </ul>
  );
}
