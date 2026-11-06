import type { Message } from '@workspace/api-client-react';
import { RichEmailPreview } from './rich-email-editor';
import { AttachmentDownloads } from './email-attachments';

export function EmailBody({ message }: { message: Message }) {
  return (
    <>
      <div data-testid="text-body">
        {message.bodyHtml ? (
          <RichEmailPreview html={message.bodyHtml} />
        ) : (
          <pre className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed">
            {message.body}
          </pre>
        )}
      </div>
      <AttachmentDownloads files={message.attachments} />
    </>
  );
}
