import { Link } from 'wouter';
import { ArrowLeft, Bot } from 'lucide-react';
import type { Activity, Message } from '@workspace/api-client-react';
import { StatusPill } from '@/components/bits';
import { MessageEngagement } from '@/components/engagement';
import { stamp } from '@/lib/glyph';
import { cn } from '@/lib/utils';

export function MessageSummary({
  m,
  awaiting,
}: {
  m: Message;
  awaiting: boolean;
}) {
  const groups = [
    { label: 'To', emails: m.toEmails ?? [m.recipientEmail] },
    { label: 'Cc', emails: m.ccEmails ?? [] },
    { label: 'Bcc', emails: m.bccEmails ?? [] },
  ];
  const shared = new Set(groups.flatMap((group) => group.emails)).size > 1;
  return (
    <>
      <Link
        href="/emails"
        data-testid="link-back"
        className="mb-3 inline-flex items-center gap-1 text-xs text-muted-foreground lg:hidden"
      >
        <ArrowLeft className="size-3" /> All emails
      </Link>
      <div className="flex flex-wrap items-center gap-2">
        {awaiting ? (
          <span
            className="inline-flex items-center gap-1.5 rounded-sm bg-[hsl(40_70%_90%)] px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[hsl(32_70%_28%)]"
            data-testid="status-awaiting-gmail"
          >
            <span className="size-1.5 animate-pulse rounded-full bg-current" />
            Awaiting Gmail send
          </span>
        ) : (
          <StatusPill status={m.status} />
        )}
        {m.deliverySource === 'gmail' && (
          <span className="font-mono text-[10px] uppercase text-muted-foreground">
            via Gmail
          </span>
        )}
      </div>
      <h2
        className="font-display mt-3 text-2xl font-bold md:text-3xl"
        data-testid="text-subject"
      >
        {m.subject}
      </h2>
      <div
        className="mt-2 text-sm text-muted-foreground"
        data-testid="text-recipient"
      >
        {groups
          .filter((group) => group.emails.length)
          .map((group) => (
            <div key={group.label} className="break-words">
              {group.label}{' '}
              <span
                className="text-foreground"
                data-testid={`text-recipient-${group.label.toLowerCase()}`}
              >
                {!shared && group.label === 'To' && m.recipientName
                  ? `${m.recipientName} <${m.recipientEmail}>`
                  : group.emails.join(', ')}
              </span>
            </div>
          ))}
        {shared && (
          <p className="mt-2 text-xs">
            Shared message: pixel loads and link requests are aggregate signals, not
            proof of which recipient acted. Bcc addresses are shown only in your
            private dashboard.
          </p>
        )}
      </div>
      <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden border border-border bg-border text-xs sm:grid-cols-5">
        {[
          ['Created', stamp(m.createdAt)],
          ['Sent', stamp(m.sentAt)],
          ['Pixel loads', m.trackOpens ? m.opens : 'off'],
          ['Click signals', m.trackClicks ? m.clicks : 'off'],
          ['Replies', m.replies ?? 0],
        ].map(([key, value]) => (
          <div
            key={key as string}
            className="min-w-0 bg-card p-3 last:col-span-2 sm:last:col-span-1"
          >
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
              {key}
            </div>
            <div className="mt-1 font-mono text-sm tabular-nums">{value}</div>
          </div>
        ))}
      </div>
      {!awaiting && m.status === 'sent' && (
        <div className="mt-3">
          <MessageEngagement m={m} />
        </div>
      )}
    </>
  );
}

export function SignalTrail({
  events,
  message,
}: {
  events: Activity[];
  message: Message;
}) {
  const emptyText =
    message.deliverySource === 'gmail' && message.status !== 'sent'
      ? 'Waiting for Gmail Sent confirmation.'
      : message.status === 'draft'
        ? 'Not sent yet.'
        : 'Quiet so far. No pixel loads, tracked-link requests, or replies detected.';
  return (
    <div className="p-5 md:p-6">
      <div className="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Signal trail
      </div>
      {!events.length ? (
        <p className="text-sm text-muted-foreground">{emptyText}</p>
      ) : (
        <ol className="relative space-y-4 border-l border-border pl-4">
          {events.map((event) => (
            <li
              key={event.id}
              className="relative"
              data-testid={`event-${event.id}`}
            >
              <span
                className={cn(
                  'absolute -left-[21px] top-1 size-2.5 rounded-[2px]',
                  event.type === 'click'
                    ? 'bg-primary'
                    : event.type === 'open'
                      ? 'bg-[hsl(var(--chart-2))]'
                      : event.type === 'reply'
                        ? 'bg-accent-foreground'
                        : 'bg-foreground',
                )}
              />
              <div className="flex items-center gap-1.5 text-sm font-medium capitalize">
                {event.type === 'sent'
                  ? 'Sent'
                  : event.type === 'reply'
                    ? 'Reply received'
                    : `${event.type} signal`}
                {event.automated && (
                  <span className="inline-flex items-center gap-1 rounded-sm bg-[hsl(40_70%_90%)] px-1 font-mono text-[9px] uppercase text-[hsl(32_70%_28%)]">
                    <Bot className="size-2.5" />
                    auto
                  </span>
                )}
              </div>
              <div className="break-words font-mono text-[10px] text-muted-foreground">
                {stamp(event.occurredAt)} ·{' '}
                {event.type === 'reply'
                  ? 'Email reply via standard Message-ID headers'
                  : event.source}
              </div>
              {event.url && (
                <div className="mt-0.5 truncate font-mono text-[10px] text-foreground/70">
                  {event.url}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
