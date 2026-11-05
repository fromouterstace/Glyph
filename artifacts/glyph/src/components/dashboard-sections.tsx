import { Link } from 'wouter';
import {
  ArrowUpRight,
  MousePointerClick,
  Eye,
  Bot,
  Reply,
  Send,
} from 'lucide-react';
import type {
  Activity,
  Connection,
  Overview,
} from '@workspace/api-client-react';
import { Skeleton } from '@/components/ui/skeleton';
import { ErrorState, Stat } from '@/components/bits';
import { ago, errorText, pct } from '@/lib/glyph';
import { cn } from '@/lib/utils';

type QueryView<T> = {
  data?: T;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => unknown;
};

export function ConnectionWarning({
  connection,
  signedIn,
}: {
  connection?: Connection;
  signedIn: boolean;
}) {
  if (!signedIn || !connection || connection.authorized) return null;
  return (
    <div
      className="border border-[hsl(var(--chart-4))]/50 bg-[hsl(40_70%_52%/0.08)] p-4 text-sm"
      data-testid="text-connection-warning"
    >
      <div className="font-semibold">This account can't send yet.</div>
      <p className="mt-1 text-muted-foreground">{connection.message}</p>
    </div>
  );
}

export function OverviewStats({ query }: { query: QueryView<Overview> }) {
  const o = query.data;
  if (query.isError)
    return (
      <ErrorState
        error={errorText(query.error)}
        onRetry={() => query.refetch()}
      />
    );
  return (
    <div className="grid grid-cols-2 border-l border-t border-border bg-card md:grid-cols-5">
      {query.isLoading || !o ? (
        Array.from({ length: 5 }).map((_, index) => (
          <div key={index} className="border-b border-r border-border p-5">
            <Skeleton className="h-3 w-16" />
            <Skeleton className="mt-3 h-9 w-20" />
          </div>
        ))
      ) : (
        <>
          <Stat label="Sent" value={o.totalSent} hint="confirmed in Gmail" />
          <Stat
            label="Pixel loads"
            value={o.totalOpens}
            hint="measured image requests"
            delay={40}
          />
          <Stat
            label="Click signals"
            value={o.totalClicks}
            hint="link redirects"
            delay={80}
          />
          <Stat
            label="Pixel-load rate"
            value={pct(o.openRate)}
            accent
            delay={120}
            hint="of tracked sends"
          />
          <Stat
            label="Tracked-link rate"
            value={pct(o.clickRate)}
            delay={160}
            hint={`${o.unreadCount} unread signals`}
          />
        </>
      )}
    </div>
  );
}

export function ActivityPreview({
  query: act,
}: {
  query: QueryView<Activity[]>;
}) {
  return (
    <section className="border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border px-5 py-4">
        <h2 className="font-display text-lg font-bold">Latest signals</h2>
        <Link
          href="/activity"
          data-testid="link-all-activity"
          className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
        >
          All activity <ArrowUpRight className="size-3" />
        </Link>
      </div>
      {act.isLoading ? (
        <div className="space-y-3 p-5">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton key={index} className="h-10" />
          ))}
        </div>
      ) : act.isError ? (
        <div className="p-5">
          <ErrorState
            error={errorText(act.error)}
            onRetry={() => act.refetch()}
          />
        </div>
      ) : !act.data?.length ? (
        <p className="p-5 text-sm text-muted-foreground">No signals yet.</p>
      ) : (
        <ul className="divide-y divide-border">
          {act.data.slice(0, 7).map((activity) => (
            <li key={activity.id}>
              <Link
                href={`/emails/${activity.messageId}`}
                data-testid={`row-signal-${activity.id}`}
                className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/50"
              >
                <span
                  className={cn(
                    'flex size-7 items-center justify-center rounded-sm',
                    activity.type === 'click'
                      ? 'bg-primary/10 text-primary'
                      : activity.type === 'open'
                        ? 'bg-[hsl(var(--chart-2)/0.12)] text-[hsl(var(--chart-2))]'
                        : activity.type === 'reply'
                          ? 'bg-accent text-accent-foreground'
                          : 'bg-secondary',
                  )}
                >
                  {activity.type === 'click' ? (
                    <MousePointerClick className="size-3.5" />
                  ) : activity.type === 'open' ? (
                    <Eye className="size-3.5" />
                  ) : activity.type === 'reply' ? (
                    <Reply className="size-3.5" />
                  ) : (
                    <Send className="size-3.5" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm">
                    {activity.type === 'open' || activity.type === 'click' ? (
                      <span className="font-medium">
                        {activity.type === 'open'
                          ? 'Pixel load recorded'
                          : 'Tracked link requested'}
                      </span>
                    ) : (
                      <>
                        <span className="font-medium">
                          {activity.recipientName || activity.recipientEmail}
                        </span>{' '}
                        <span className="text-muted-foreground">
                          {activity.type === 'sent'
                            ? 'was sent'
                            : activity.type === 'reply'
                              ? 'replied'
                              : 'signal'}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {activity.subject}
                  </div>
                </div>
                {activity.automated && (
                  <Bot
                    className="size-3.5 text-[hsl(32_70%_38%)]"
                    aria-label="Likely automated"
                  />
                )}
                <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                  {ago(activity.occurredAt)}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
