import sanitizeHtml from 'sanitize-html';
import { ComposerError } from './composer-policy';
import { safeHttpUrl as safeUrl, linkifyHtml } from './html-links';
export function sanitizeEmailHtml(
  value: string,
  destinations?: Map<string, string>,
): string {
  const clean = sanitizeHtml(value, {
    allowedTags: [
      'p',
      'br',
      'div',
      'span',
      'strong',
      'b',
      'em',
      'i',
      'u',
      's',
      'ul',
      'ol',
      'li',
      'a',
    ],
    allowedAttributes: { '*': ['style'], a: ['href', 'title'] },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowProtocolRelative: false,
    allowedStyles: {
      '*': {
        'font-family': [/^[a-zA-Z0-9 ,'"-]{1,100}$/],
        'font-size': [/^(?:[1-9]|[1-8][0-9]|9[0-6])(?:px|pt)$/],
        color: [
          /^#[0-9a-fA-F]{3,8}$/,
          /^rgb\(\s*\d{1,3},\s*\d{1,3},\s*\d{1,3}\s*\)$/,
        ],
        'text-align': [/^(left|center|right|justify)$/],
        'text-decoration': [/^(underline|line-through)$/],
        'font-weight': [/^(bold|[1-9]00)$/],
        'font-style': [/^italic$/],
      },
    },
    transformTags: {
      a: (tagName, attribs) => {
        const href = attribs.href;
        if (href && !href.startsWith('mailto:') && !safeUrl(href))
          delete attribs.href;
        else if (href && destinations?.has(href))
          attribs.href = destinations.get(href)!;
        return { tagName, attribs };
      },
    },
  });
  return linkifyHtml(clean, destinations);
}
export function messageHtml(value?: string | null): string | null {
  if (!value) return null;
  const clean = sanitizeEmailHtml(value);
  if (clean.length > 50000)
    throw new ComposerError(400, 'The formatted message is too long.');
  return clean;
}
export function richLinkUrls(html?: string | null): string[] {
  const urls = new Set<string>();
  sanitizeHtml(html ?? '', {
    allowedTags: ['a'],
    allowedAttributes: { a: ['href'] },
    transformTags: {
      a: (tagName, attribs) => {
        if (attribs.href && safeUrl(attribs.href)) urls.add(attribs.href);
        return { tagName, attribs };
      },
    },
  });
  return [...urls].slice(0, 100);
}
