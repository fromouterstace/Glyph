import { sanitizeEmailHtml } from './email-html';
export const escapeHtml = (value: string) =>
  value.replace(
    /[&<>"']/g,
    (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[
        c
      ]!,
  );

export function extractUrls(text: string): string[] {
  const found = text.match(/https?:\/\/[^\s<>"']+/gi) ?? [];
  return [
    ...new Set(
      found
        .map((s) => s.replace(/[.,;!?)\]]+$/, ''))
        .filter((s) => {
          try {
            const u = new URL(s);
            return (
              ['https:', 'http:'].includes(u.protocol) &&
              !u.username &&
              !u.password
            );
          } catch {
            return false;
          }
        }),
    ),
  ].slice(0, 100);
}

type TrackedContent = {
  body: string;
  bodyHtml?: string | null;
  trackClicks: boolean;
  trackOpens: boolean;
  pixelToken: string;
};
type TrackingLink = { url: string; token: string };

/** Pure rendering: no Gmail calls, tokens generated, database writes or sends. */
export function trackedEmailHtml(
  message: TrackedContent,
  base: string,
  links: TrackingLink[],
): string {
  const urls = extractUrls(message.body);
  let htmlBody = escapeHtml(message.body);
  if (urls.length && !message.bodyHtml) {
    const destinations = new Map(
      links.map((link) => [
        escapeHtml(link.url),
        `${base}/api/glyph/l/${link.token}`,
      ]),
    );
    const alternatives = urls
      .map(escapeHtml)
      .sort((a, b) => b.length - a.length)
      .map((url) => url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
    // One pass: URLs inside inserted tracking links must never be rewritten.
    htmlBody = htmlBody.replace(
      new RegExp(alternatives.join('|'), 'g'),
      (url) => `<a href="${destinations.get(url) ?? url}">${url}</a>`,
    );
  }
  if (message.bodyHtml) {
    const destinations = new Map(
      (message.trackClicks ? links : []).map((link) => [
        link.url,
        `${base}/api/glyph/l/${link.token}`,
      ]),
    );
    htmlBody = sanitizeEmailHtml(message.bodyHtml, destinations);
  }
  const footer =
    message.trackClicks || message.trackOpens
      ? '<p style="font-size:11px;color:#777;margin-top:24px">Sent with Glyph. This email uses engagement tracking; image and link requests may be recorded.</p>'
      : '';
  const pixel = message.trackOpens
    ? `<img src="${base}/api/glyph/t/${message.pixelToken}.gif" width="1" height="1" alt="" style="border:0;width:1px;height:1px" />`
    : '';
  return `<html><body><div style="font:15px/1.6 Arial,sans-serif;white-space:pre-wrap">${htmlBody}</div>${footer}${pixel}</body></html>`;
}
