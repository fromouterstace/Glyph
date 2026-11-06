import type {
  Message,
  MessageInput,
  SettingsInput,
} from '@workspace/api-client-react';

export function composerAttachments(message?: Message | null) {
  return message?.attachments ?? [];
}

export function initialComposerForm(
  message: Message | null | undefined,
  settings?: SettingsInput,
): MessageInput {
  if (message)
    return {
      recipientEmail: message.recipientEmail,
      recipientName: message.recipientName,
      subject: message.subject,
      body: message.body,
      bodyHtml: message.bodyHtml ?? null,
      attachmentIds: (message.attachments ?? []).map((file) => file.id),
      trackOpens: message.trackOpens,
      trackClicks: message.trackClicks,
    };
  return {
    recipientEmail: '',
    recipientName: '',
    subject: '',
    body: '',
    bodyHtml: null,
    attachmentIds: [],
    trackOpens: settings?.defaultTrackOpens ?? true,
    trackClicks: settings?.defaultTrackClicks ?? true,
  };
}
