import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Message } from '@workspace/api-client-react';
import { MessageSummary } from '../src/components/message-summary';

const message: Message = {
  id: 'fixture',
  recipientEmail: 'to@example.invalid',
  recipientName: 'Recipient',
  subject: 'Proposal',
  body: 'Hello',
  trackOpens: true,
  trackClicks: true,
  status: 'sent',
  createdAt: '2026-11-04T12:00:00.000Z',
  sentAt: null,
  opens: 0,
  clicks: 0,
  replies: 0,
  lastActivityAt: null,
  deliverySource: 'gmail',
};

describe('private message recipient summary', () => {
  it('shows To/Cc/Bcc roles and the aggregate attribution warning', () => {
    const html = renderToStaticMarkup(
      <MessageSummary
        m={{
          ...message,
          toEmails: ['to@example.invalid', 'second@example.invalid'],
          ccEmails: ['cc@example.invalid'],
          bccEmails: ['hidden@example.invalid'],
        }}
        awaiting={false}
      />,
    );
    for (const role of ['to', 'cc', 'bcc'])
      expect(html).toContain(`text-recipient-${role}`);
    expect(html).toContain('hidden@example.invalid');
    expect(html).toContain('aggregate signals');
  });
  it('does not invent To for a Bcc-only message', () => {
    const html = renderToStaticMarkup(
      <MessageSummary
        m={{
          ...message,
          toEmails: [],
          ccEmails: [],
          bccEmails: ['hidden@example.invalid'],
        }}
        awaiting={false}
      />,
    );
    expect(html).not.toContain('text-recipient-to');
    expect(html).toContain('text-recipient-bcc');
  });
  it('preserves legacy single-recipient names', () => {
    const html = renderToStaticMarkup(
      <MessageSummary m={message} awaiting={false} />,
    );
    expect(html).toContain('Recipient');
    expect(html).toContain('to@example.invalid');
    expect(html).not.toContain('aggregate signals');
  });
});
