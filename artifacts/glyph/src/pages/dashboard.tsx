import { Link } from 'wouter';
import { ArrowUpRight, Download, MousePointerClick, Eye, Bot } from 'lucide-react';
import {
  useGetOverview,
  useListActivity,
  useListMessages,
  useGetConnection,
  getGetOverviewQueryKey,
  getListActivityQueryKey,
} from '@workspace/api-client-react';
import { Skeleton } from '@/components/ui/skeleton';
import { Avatar, Caveat, DailyBars, DemoTag, EmptyState, ErrorState, Stat, StatusPill } from '@/components/bits';
import { GMAIL_URL, SyncGmailButton } from '@/components/gmail-sync';
import { ago, errorText, pct, usePoll, useSession } from '@/lib/glyph';
import { cn } from '@/lib/utils';

export default function Dashboard() {
  const { isSignedIn } = useSession();
  const poll = usePoll();
  const ov = useGetOverview({ query: { refetchInterval: poll, queryKey: getGetOverviewQueryKey() } });
  const act = useListActivity({ query: { refetchInterval: poll, queryKey: getListActivityQueryKey() } });
  const msgs = useListMessages();
  const conn = useGetConnection();
  const o = ov.data;
  const isDemo = o?.isDemo ?? !isSignedIn;
  const empty = o && !o.isDemo && o.totalSent === 0 && (msgs.data?.length ?? 0) === 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="rise max-w-2xl">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">After send</span>
            {isDemo && <DemoTag />}
          </div>
          <h1 className="font-display mt-2 text-4xl font-extrabold leading-[0.95] md:text-6xl">
            {isSignedIn ? 'What your emails did next.' : <>See what happened<br />after you hit Send.</>}
          </h1>
          <p className="mt-4 max-w-xl text-sm text-muted-foreground md:text-base">
            Write in Gmail as usual. The Glyph extension drops a tiny pixel and wraps your links in the draft, then this dashboard turns what comes back into signals you can act on. Honest ones: a signal means an image loaded or a link resolved, never a guaranteed read.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isSignedIn ? (
            <>
              <Link href="/gmail" data-testid="link-install-gmail" className="inline-flex items-center gap-2 rounded-sm bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-transform hover:bg-primary/90 active:scale-[0.98]"><Download className="size-4" /> Install for Gmail</Link>
              <a href={GMAIL_URL} target="_blank" rel="noreferrer" data-testid="link-open-gmail-hero" className="inline-flex items-center gap-2 rounded-sm border border-border bg-card px-4 py-2.5 text-sm font-medium hover:border-foreground/40">Open Gmail <ArrowUpRight className="size-4" /></a>
              <SyncGmailButton className="py-2.5" />
            </>
          ) : (
            <>
              <Link href="/sign-in" data-testid="link-signin-hero" className="inline-flex items-center gap-2 rounded-sm bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90">Sign in with Gmail owner</Link>
              <Link href="/sign-up" data-testid="link-signup-hero" className="inline-flex items-center gap-2 rounded-sm border border-border bg-card px-4 py-2.5 text-sm font-medium hover:border-foreground/40">Create account</Link>
            </>
          )}
        </div>
      </div>

      {isSignedIn && conn.data && !conn.data.authorized && (
        <div className="border border-[hsl(var(--chart-4))]/50 bg-[hsl(40_70%_52%/0.08)] p-4 text-sm" data-testid="text-connection-warning">
          <div className="font-semibold">This account can't send yet.</div>
          <p className="mt-1 text-muted-foreground">{conn.data.message}</p>
        </div>
      )}

      {ov.isError ? (
        <ErrorState error={errorText(ov.error)} onRetry={() => ov.refetch()} />
      ) : (
        <div className="grid grid-cols-2 border-l border-t border-border bg-card md:grid-cols-5">
          {ov.isLoading || !o ? (
            Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="border-b border-r border-border p-5"><Skeleton className="h-3 w-16" /><Skeleton className="mt-3 h-9 w-20" /></div>
            ))
          ) : (
            <>
              <Stat label="Sent" value={o.totalSent} hint="confirmed in Gmail" />
              <Stat label="Open signals" value={o.totalOpens} hint="pixel loads" delay={40} />
              <Stat label="Click signals" value={o.totalClicks} hint="link redirects" delay={80} />
              <Stat label="Open-signal rate" value={pct(o.openRate)} accent delay={120} hint="of tracked sends" />
              <Stat label="Click rate" value={pct(o.clickRate)} delay={160} hint={`${o.unreadCount} unread signals`} />
            </>
          )}
        </div>
      )}

      {empty ? (
        <div className="border border-border bg-card">
          <EmptyState
            title="Nothing sent yet. That's honest."
            body={<>Your live dashboard starts empty, no seeded events. Install the Gmail extension, compose to one person in Gmail, click Add glyph, and send with Gmail. Once the send shows up in your Sent folder, signals land here.</>}
            action={<div className="mt-2 flex flex-wrap justify-center gap-2"><Link href="/gmail" data-testid="link-install-empty" className="rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground">Install for Gmail</Link><a href={GMAIL_URL} target="_blank" rel="noreferrer" className="rounded-sm border border-border px-4 py-2 text-sm font-medium">Open Gmail</a></div>}
          />
          <ol className="grid border-t border-border text-sm md:grid-cols-3">
            {['Load the unpacked extension in Chrome or Edge and connect it to this origin.', 'Sign in on the connection tab with the email that owns your Gmail.', 'In Gmail: one To recipient, Add glyph, then Gmail Send.'].map((s, i) => (
              <li key={i} className="flex gap-3 border-b border-border p-4 md:border-b-0 md:border-r last:border-r-0">
                <span className="font-mono text-xs text-primary">0{i + 1}</span>{s}
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <section className="border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">Daily signal</h2>
              <span className="font-mono text-[10px] uppercase text-muted-foreground">{o?.daily.length ?? 0} days</span>
            </div>
            {ov.isLoading ? <Skeleton className="h-44 w-full" /> : <DailyBars daily={o?.daily ?? []} />}
          </section>
          <section className="border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h2 className="font-display text-lg font-bold">Latest signals</h2>
              <Link href="/activity" data-testid="link-all-activity" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">All activity <ArrowUpRight className="size-3" /></Link>
            </div>
            {act.isLoading ? (
              <div className="space-y-3 p-5">{[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10" />)}</div>
            ) : act.isError ? (
              <div className="p-5"><ErrorState error={errorText(act.error)} onRetry={() => act.refetch()} /></div>
            ) : !act.data?.length ? (
              <p className="p-5 text-sm text-muted-foreground">No signals yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {act.data.slice(0, 7).map((a) => (
                  <li key={a.id}>
                    <Link href={`/emails/${a.messageId}`} data-testid={`row-signal-${a.id}`} className="flex items-center gap-3 px-5 py-3 transition-colors hover:bg-muted/50">
                      <span className={cn('flex size-7 items-center justify-center rounded-sm', a.type === 'click' ? 'bg-primary/10 text-primary' : a.type === 'open' ? 'bg-accent text-accent-foreground' : 'bg-secondary')}>
                        {a.type === 'click' ? <MousePointerClick className="size-3.5" /> : a.type === 'open' ? <Eye className="size-3.5" /> : <ArrowUpRight className="size-3.5" />}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm"><span className="font-medium">{a.recipientName || a.recipientEmail}</span> <span className="text-muted-foreground">{a.type === 'sent' ? 'was sent' : a.type === 'open' ? 'loaded the glyph' : 'clicked a link'}</span></div>
                        <div className="truncate text-xs text-muted-foreground">{a.subject}</div>
                      </div>
                      {a.automated && <Bot className="size-3.5 text-[hsl(32_70%_38%)]" aria-label="Likely automated" />}
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">{ago(a.occurredAt)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}

      {!empty && (
        <section className="border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="font-display text-lg font-bold">Recent messages</h2>
            <Link href="/emails" data-testid="link-all-emails" className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline">All emails <ArrowUpRight className="size-3" /></Link>
          </div>
          {msgs.isLoading ? (
            <div className="space-y-2 p-5">{[0, 1, 2].map((i) => <Skeleton key={i} className="h-9" />)}</div>
          ) : (
            <ul className="divide-y divide-border">
              {(msgs.data ?? []).slice(0, 5).map((m) => (
                <li key={m.id}>
                  <Link href={`/emails/${m.id}`} data-testid={`row-recent-${m.id}`} className="grid grid-cols-[auto_1fr_auto] items-center gap-3 px-5 py-3 hover:bg-muted/50 md:grid-cols-[auto_1fr_auto_auto_auto]">
                    <Avatar name={m.recipientName} email={m.recipientEmail} />
                    <div className="min-w-0"><div className="truncate text-sm font-medium">{m.subject}</div><div className="truncate text-xs text-muted-foreground">{m.recipientName || m.recipientEmail}</div></div>
                    <StatusPill status={m.status} />
                    <span className="hidden font-mono text-xs tabular-nums text-muted-foreground md:block">{m.opens}o / {m.clicks}c</span>
                    <span className="hidden font-mono text-[10px] text-muted-foreground md:block">{ago(m.lastActivityAt ?? m.sentAt ?? m.createdAt)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Caveat>
        <strong>How to read these numbers.</strong> Apple Mail Privacy Protection and Gmail's image proxy can preload or cache the pixel, inflating or hiding opens. Security scanners can follow links before a human does; those are flagged as automated in Activity. Replies and bounces aren't tracked.
      </Caveat>

    </div>
  );
}

