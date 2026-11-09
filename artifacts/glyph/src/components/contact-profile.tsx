import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { ArrowUpRight } from 'lucide-react';
import type {
  ContactDetail,
  ContactEvent,
  ContactMessage,
} from '@workspace/api-client-react';
import { Avatar, Caveat, StatusPill } from '@/components/bits';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';

export function preciseStamp(iso: string | null | undefined) {
  if (!iso) return 'Not recorded';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Not recorded';
  return format(d, 'MMM d, yyyy HH:mm:ss');
}

/** Only http(s) destinations are ever rendered as links. */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

export function daysLabel(days: number | null) {
  if (days === null) return 'No communication recorded';
  if (days === 0) return 'Today';
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

const SOURCE_LABEL = {
  web: 'Web composer',
  gmail: 'Gmail extension',
  import: 'Imported from Gmail label',
} as const;

const EVENT_LABEL = {
  sent: 'Sent',
  open: 'Pixel load',
  click: 'Link request',
  reply: 'Reply recorded',
} as const;

export function ContactHeader({ detail }: { detail: ContactDetail }) {
  const c = detail.contact;
  const name = `${c.firstName} ${c.lastName}`.trim();
  return (
    <div className="flex flex-wrap items-center gap-4">
      <Avatar name={name} email={c.email} className="size-14 text-base" />
      <div className="min-w-0">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
          Contact
        </div>
        <h1
          className="font-display mt-1 truncate text-3xl font-extrabold md:text-4xl"
          data-testid="text-contact-name"
        >
          {name || c.email}
        </h1>
        <div className="mt-1 flex flex-wrap gap-x-3 font-mono text-xs text-muted-foreground">
          <span data-testid="text-contact-email">{c.email}</span>
          <span>{c.emailSuffix}</span>
          <span>added {preciseStamp(c.createdAt)}</span>
        </div>
      </div>
    </div>
  );
}

function Figure(props: {
  label: string;
  value: ReactNode;
  hint: string;
  id: string;
  accent?: boolean;
}) {
  return (
    <div className="border-b border-r border-border p-4 last:border-r-0">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
        {props.label}
      </div>
      <div
        data-testid={`stat-${props.id}`}
        className={cn(
          'font-display mt-2 text-2xl font-bold tabular-nums md:text-3xl',
          props.accent && 'text-primary',
        )}
      >
        {props.value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{props.hint}</div>
    </div>
  );
}

export function ContactFigures({ detail }: { detail: ContactDetail }) {
  return (
    <div className="grid grid-cols-2 border-l border-t border-border bg-card md:grid-cols-5">
      <Figure
        id="days-since"
        accent
        label="Last communication"
        value={daysLabel(detail.daysSinceLastCommunication)}
        hint={
          detail.lastCommunicationAt
            ? preciseStamp(detail.lastCommunicationAt)
            : 'No stored send or reply'
        }
      />
      <Figure
        id="messages"
        label="Messages"
        value={detail.totalMessages}
        hint="Stored correspondence"
      />
      <Figure
        id="pixel-loads"
        label="Pixel loads"
        value={detail.pixelLoads}
        hint="Message-level, approximate"
      />
      <Figure
        id="link-requests"
        label="Link requests"
        value={detail.linkRequests}
        hint="Message-level, approximate"
      />
      <Figure
        id="replies"
        label="Replies"
        value={detail.replies}
        hint="Any thread participant"
      />
    </div>
  );
}

export function SignalCaveat() {
  return (
    <Caveat>
      Pixel loads and link requests are recorded per message, not per person.
      They are not verified reads or confirmed clicks: mail clients, security
      scanners and image proxies can trigger them, and on messages shared with
      several recipients they cannot show who engaged. Replies on shared threads
      may come from other participants. Last communication uses stored sent or
      received email timestamps and recorded replies, never pixel loads or link
      requests. Imported messages have no historical tracking. Only
      correspondence stored in Glyph is included, not your entire Gmail history.
    </Caveat>
  );
}

export function MessageRow({ m }: { m: ContactMessage }) {
  const tracking =
    m.deliverySource === 'import'
      ? 'No historical tracking'
      : [m.trackOpens && 'pixel', m.trackClicks && 'links']
          .filter(Boolean)
          .join(' + ') || 'Untracked';
  return (
    <li>
      <Link
        href={`/emails/${m.id}`}
        data-testid={`link-contact-message-${m.id}`}
        className="group block px-4 py-3 outline-none hover:bg-secondary/60 focus-visible:bg-secondary/60 focus-visible:ring-2 focus-visible:ring-ring"
      >
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill status={m.status} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium">
            {m.subject || '(no subject)'}
          </span>
          <ArrowUpRight className="size-3.5 text-muted-foreground group-hover:text-primary" />
        </div>
        {m.excerpt && (
          <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
            {m.excerpt}
          </p>
        )}
        <div className="mt-1.5 flex flex-wrap gap-x-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          <span>{SOURCE_LABEL[m.deliverySource]}</span>
          <span>
            {m.sentAt ? `sent ${preciseStamp(m.sentAt)}` : 'not sent'}
          </span>
          <span data-testid={`text-tracking-${m.id}`}>{tracking}</span>
        </div>
      </Link>
    </li>
  );
}

function Destination({ url }: { url: string | null }) {
  if (!url) return null;
  const href = safeHref(url);
  if (!href)
    return (
      <span className="break-all font-mono text-[11px] text-muted-foreground">
        {url}
      </span>
    );
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer nofollow"
      data-testid="link-event-url"
      className="break-all font-mono text-[11px] text-primary underline-offset-2 hover:underline"
    >
      {url}
    </a>
  );
}

export function EventRow({ e }: { e: ContactEvent }) {
  return (
    <li data-testid={`row-contact-event-${e.id}`} className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={cn(
            'rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider',
            e.type === 'click'
              ? 'border-primary/40 text-primary'
              : 'border-border text-foreground/80',
          )}
        >
          {EVENT_LABEL[e.type]}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
          {e.automated ? 'Likely automated' : 'Not flagged automated'} ·{' '}
          {e.source}
        </span>
        <time
          dateTime={e.occurredAt}
          className="ml-auto font-mono text-[11px] tabular-nums text-muted-foreground"
        >
          {preciseStamp(e.occurredAt)}
        </time>
      </div>
      <Link
        href={`/emails/${e.messageId}`}
        data-testid={`link-event-message-${e.id}`}
        className="mt-1 block truncate text-sm hover:text-primary"
      >
        {e.subject || '(no subject)'}
      </Link>
      <Destination url={e.url} />
    </li>
  );
}

export function OffsetPager(props: {
  scope: string;
  offset: number;
  limit: number;
  total: number;
  shown: number;
  busy: boolean;
  onOffset: (n: number) => void;
}) {
  const { scope, offset, limit, total, shown, busy, onOffset } = props;
  if (total <= limit && offset === 0) return null;
  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-2 font-mono text-[11px] text-muted-foreground">
      <span data-testid={`text-${scope}-range`}>
        {shown ? `${offset + 1}-${offset + shown}` : '0'} of {total}
      </span>
      <div className="flex gap-1">
        <button
          type="button"
          data-testid={`button-${scope}-newer`}
          disabled={offset === 0 || busy}
          onClick={() => onOffset(Math.max(0, offset - limit))}
          className="rounded-sm border border-border px-2 py-1 disabled:opacity-40"
        >
          Newer
        </button>
        <button
          type="button"
          data-testid={`button-${scope}-older`}
          disabled={offset + limit >= total || busy}
          onClick={() => onOffset(offset + limit)}
          className="rounded-sm border border-border px-2 py-1 disabled:opacity-40"
        >
          Older
        </button>
      </div>
    </div>
  );
}
