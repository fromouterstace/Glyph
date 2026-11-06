import { validTrackingOrigin } from './tracking-origin';

export function composerDeliveryIssue(origin: string, trackingUrl?: string) {
  if (!origin || !validTrackingOrigin(origin, origin))
    return {
      kind: 'preview' as const,
      message:
        'Preview supports saving and editing drafts, not real email sending. Open published Glyph → Emails → Web composer to send. The browser extension is not required.',
    };
  if (trackingUrl === undefined)
    return {
      kind: 'settings' as const,
      message:
        'Sending is unavailable until your tracking settings load. Recheck settings; your edits will stay here.',
    };
  if (!validTrackingOrigin(trackingUrl, origin))
    return {
      kind: 'settings' as const,
      message:
        'The custom Tracking URL points outside this Glyph app or is invalid. Clear it in Settings, then recheck here. Your edits will stay here.',
    };
  return null;
}
