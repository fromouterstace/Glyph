import { useState } from 'react';
import { Link } from 'wouter';
import {
  Eye,
  MousePointerClick,
  Send,
  Bot,
  CheckCheck,
  Reply,
} from 'lucide-react';
import {
  useListActivity,
  useMarkActivityRead,
  getListActivityQueryKey,
} from '@workspace/api-client-react';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Caveat,
  ReadOnlyTag,
  EmptyState,
  ErrorState,
  SectionHead,
} from '@/components/bits';
import {
  errorText,
  stamp,
  ago,
  usePoll,
  useInvalidateAll,
  useSession,
} from '@/lib/glyph';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const FILTERS = [
  'all',
  'open',
  'click',
  'reply',
  'sent',
  'human',
  'automated',
] as const;

export default function ActivityPage() {
  const poll = usePoll();
  const { isSignedIn } = useSession();
  const { toast } = useToast();
  const invalidate = useInvalidateAll();
  const [f, setF] = useState<(typeof FILTERS)[number]>('all');
  const [offset, setOffset] = useState(0);
  const params = {
    limit: 50,
    offset,
    ...(f === 'all' ? {} : { type: f }),
  };
  const q = useListActivity(params, {
    query: {
      refetchInterval: poll,
      queryKey: getListActivityQueryKey(params),
    },
  });
  const mark = useMarkActivityRead();
  const data = q.data?.items ?? [];
  const readOnly = !isSignedIn;
  const rows = data;

  return (
    <div className="space-y-6">
      <SectionHead
        kicker="Engagement feed"
        title={
          <span className="flex items-center gap-3">
            Activity {readOnly && <ReadOnlyTag />}
          </span>
        }
        right={
          <button
            data-testid="button-mark-read"
            disabled={!isSignedIn || mark.isPending}
            onClick={() =>
              mark.mutate(undefined, {
                onSuccess: () => {
                  invalidate();
                  toast({ title: 'All caught up' });
                },
                onError: (e) =>
                  toast({
                    title: 'Could not mark read',
                    description: errorText(e),
                    variant: 'destructive',
                  }),
              })
            }
            className="inline-flex items-center gap-2 rounded-sm border border-border bg-card px-3 py-2 text-sm font-medium hover:border-foreground/40 disabled:opacity-40"
          >
            <CheckCheck className="size-4" /> Mark all read
          </button>
        }
      />
      <Caveat>
        <strong>Source</strong> classifies request patterns; it does not verify
        who fetched a pixel or requested a link. Image proxies (Gmail, Apple
        MPP) may load pixels without a human, and security scanners often
        request links seconds after delivery. Those are marked <em>auto</em>.
        Pixel and link-request signals are not attributed to an individual
        recipient.
        <strong>Replies</strong> are matched by standard In-Reply-To/References
        headers, so they work whatever mail service the recipient uses;
        auto-replies, bounces and your own follow-ups are skipped. Gmail sync
        scans only your 100 most recent received messages from the last 30 days.
        Pixel counts are measured image requests and are never inferred from
        replies. No signal here is a guaranteed read. During exceptional request
        bursts, safety limits may still serve an image or redirect without
        recording another event, so counts can understate excess requests.
      </Caveat>
      <div className="flex flex-wrap gap-1">
        {FILTERS.map((x) => (
          <button
            key={x}
            data-testid={`filter-${x}`}
            onClick={() => {
              setF(x);
              setOffset(0);
            }}
            className={cn(
              'rounded-sm px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider',
              f === x
                ? 'bg-foreground text-background'
                : 'text-muted-foreground hover:bg-muted',
            )}
          >
            {x === 'human'
              ? 'unflagged'
              : x === 'open'
                ? 'pixel loads'
                : x === 'click'
                  ? 'link requests'
                  : x}
          </button>
        ))}
      </div>
      <div className="border border-border bg-card">
        {q.isLoading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        ) : q.isError ? (
          <div className="p-4">
            <ErrorState
              error={errorText(q.error)}
              onRetry={() => q.refetch()}
            />
          </div>
        ) : !rows.length ? (
          <EmptyState
            title={
              q.data?.pagination.total ? 'No signals on this page' : 'No signals yet'
            }
            body={
              q.data?.pagination.total
                ? 'Try a newer or older page.'
                : 'When Glyph receives an eligible pixel or tracked-link request, it appears here within about ten seconds.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead>
                <tr className="border-b border-border text-left font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-2.5 font-normal">Signal</th>
                  <th className="px-4 py-2.5 font-normal">Participant</th>
                  <th className="px-4 py-2.5 font-normal">Message</th>
                  <th className="px-4 py-2.5 font-normal">Source</th>
                  <th className="px-4 py-2.5 text-right font-normal">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((a) => (
                  <tr
                    key={a.id}
                    className={cn(
                      'transition-colors hover:bg-muted/40',
                      !a.read && 'bg-primary/[0.035]',
                    )}
                    data-testid={`row-activity-${a.id}`}
                  >
                    <td className="px-4 py-3">
                      <span className="inline-flex items-center gap-2">
                        {!a.read && (
                          <span className="size-1.5 rounded-full bg-primary" />
                        )}
                        {a.type === 'open' ? (
                          <Eye className="size-4 text-[hsl(var(--chart-2))]" />
                        ) : a.type === 'click' ? (
                          <MousePointerClick className="size-4 text-primary" />
                        ) : a.type === 'reply' ? (
                          <Reply className="size-4 text-accent-foreground" />
                        ) : (
                          <Send className="size-4" />
                        )}
                        <span>
                          {a.type === 'reply'
                            ? 'Reply'
                            : a.type === 'open'
                              ? 'Pixel load'
                              : a.type === 'click'
                                ? 'Link request'
                                : 'Sent'}
                        </span>
                        {a.automated && (
                          <span className="inline-flex items-center gap-1 rounded-sm bg-[hsl(40_70%_90%)] px-1 font-mono text-[9px] uppercase text-[hsl(32_70%_28%)]">
                            <Bot className="size-2.5" />
                            auto
                          </span>
                        )}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-medium">
                        {a.type === 'open' || a.type === 'click'
                          ? 'Not attributed'
                          : a.recipientName || a.recipientEmail}
                      </div>
                      {a.type !== 'open' && a.type !== 'click' && (
                        <div className="text-xs text-muted-foreground">
                          {a.recipientEmail}
                        </div>
                      )}
                    </td>
                    <td className="max-w-[260px] px-4 py-3">
                      <Link
                        href={`/emails/${a.messageId}`}
                        className="block truncate hover:text-primary hover:underline"
                        data-testid={`link-activity-message-${a.id}`}
                      >
                        {a.subject}
                      </Link>
                      {a.url && (
                        <div className="truncate font-mono text-[10px] text-muted-foreground">
                          {a.url}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                      {a.type === 'reply'
                        ? 'Email reply via standard Message-ID headers'
                        : a.source}
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 text-right font-mono text-xs">
                      <div>{ago(a.occurredAt)}</div>
                      <div className="text-[10px] text-muted-foreground">
                        {stamp(a.occurredAt)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {q.data?.pagination && (
        <div className="flex items-center justify-between gap-2 border border-border bg-card px-4 py-3 text-xs">
          <span className="font-mono text-muted-foreground">
            {q.data.pagination.total === 0
              ? '0 signals'
              : `${offset + 1}–${Math.min(offset + data.length, q.data.pagination.total)} of ${q.data.pagination.total}`}
          </span>
          <div className="flex gap-1">
            <button
              type="button"
              data-testid="button-previous-activity"
              disabled={offset === 0}
              onClick={() => setOffset((current) => Math.max(0, current - 50))}
              className="rounded-sm border border-border px-2 py-1 disabled:opacity-40"
            >
              Newer
            </button>
            <button
              type="button"
              data-testid="button-next-activity"
              disabled={!q.data.pagination.hasMore}
              onClick={() => setOffset((current) => current + 50)}
              className="rounded-sm border border-border px-2 py-1 disabled:opacity-40"
            >
              Older
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
