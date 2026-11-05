import { Link } from 'wouter';
import { ArrowUpRight, Download } from 'lucide-react';
import {
  ActivityPreview,
  ConnectionWarning,
  OverviewStats,
} from '@/components/dashboard-sections';
import { MessageEngagement } from '@/components/engagement';
import {
  useGetOverview,
  useListActivity,
  useListMessages,
  useGetConnection,
  getGetOverviewQueryKey,
  getListActivityQueryKey,
} from '@workspace/api-client-react';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Avatar,
  Caveat,
  DailyBars,
  ReadOnlyTag,
  EmptyState,
  ErrorState,
  StatusPill,
} from '@/components/bits';
import { GMAIL_URL, SyncGmailButton } from '@/components/gmail-sync';
import { ago, errorText, usePoll, useSession } from '@/lib/glyph';

export default function Dashboard() {
  const { isSignedIn } = useSession();
  const poll = usePoll();
  const ov = useGetOverview({
    query: { refetchInterval: poll, queryKey: getGetOverviewQueryKey() },
  });
  const act = useListActivity({
    query: { refetchInterval: poll, queryKey: getListActivityQueryKey() },
  });
  const msgs = useListMessages();
  const conn = useGetConnection();
  const o = ov.data;
  const readOnly = o?.readOnly ?? !isSignedIn;
  const empty =
    !!o &&
    !o.readOnly &&
    o.totalSent === 0 &&
    msgs.isSuccess &&
    msgs.data.length === 0;

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
        <div className="rise max-w-2xl">
          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">
              After send
            </span>
            {readOnly && <ReadOnlyTag />}
          </div>
          <h1 className="font-display mt-2 text-4xl font-extrabold leading-[0.95] md:text-6xl">
            {isSignedIn ? (
              'What your emails did next.'
            ) : (
              <>
                See what happened
                <br />
                after you hit Send.
              </>
            )}
          </h1>
          <p className="mt-4 max-w-xl text-sm text-muted-foreground md:text-base">
            Write in Gmail as usual. The Glyph extension drops a tiny pixel and
            wraps your links in the draft, then this dashboard turns what comes
            back into signals you can act on. Honest ones: a signal means an
            image loaded or a link resolved, never a guaranteed read.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isSignedIn ? (
            <>
              <Link
                href="/gmail"
                data-testid="link-install-gmail"
                className="inline-flex items-center gap-2 rounded-sm bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-transform hover:bg-primary/90 active:scale-[0.98]"
              >
                <Download className="size-4" /> Install for Gmail
              </Link>
              <a
                href={GMAIL_URL}
                target="_blank"
                rel="noreferrer"
                data-testid="link-open-gmail-hero"
                className="inline-flex items-center gap-2 rounded-sm border border-border bg-card px-4 py-2.5 text-sm font-medium hover:border-foreground/40"
              >
                Open Gmail <ArrowUpRight className="size-4" />
              </a>
              <SyncGmailButton className="py-2.5" />
            </>
          ) : (
            <>
              <Link
                href="/sign-in"
                data-testid="link-signin-hero"
                className="inline-flex items-center gap-2 rounded-sm bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
              >
                Sign in with Gmail owner
              </Link>
              <Link
                href="/sign-up"
                data-testid="link-signup-hero"
                className="inline-flex items-center gap-2 rounded-sm border border-border bg-card px-4 py-2.5 text-sm font-medium hover:border-foreground/40"
              >
                Create account
              </Link>
            </>
          )}
        </div>
      </div>

      <ConnectionWarning connection={conn.data} signedIn={isSignedIn} />
      <OverviewStats query={ov} />

      {empty ? (
        <div className="border border-border bg-card">
          <EmptyState
            title="Nothing sent yet. That's honest."
            body={
              <>
                Your live dashboard starts empty, with no seeded events. Install
                the Gmail extension, compose to up to 100 unique To, Cc, and Bcc
                recipients, click Add glyph, and send with Gmail. Once the send
                is confirmed from your Sent folder, signals land here.
              </>
            }
            action={
              <div className="mt-2 flex flex-wrap justify-center gap-2">
                <Link
                  href="/gmail"
                  data-testid="link-install-empty"
                  className="rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground"
                >
                  Install for Gmail
                </Link>
                <a
                  href={GMAIL_URL}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-sm border border-border px-4 py-2 text-sm font-medium"
                >
                  Open Gmail
                </a>
              </div>
            }
          />
          <ol className="grid border-t border-border text-sm md:grid-cols-3">
            {[
              'Load the unpacked extension in Chrome or Edge and connect it to this origin.',
              'Sign in on the connection tab with the email that owns your Gmail.',
              'In Gmail: To, Cc or Bcc recipients, Add glyph, then Gmail Send.',
            ].map((s, i) => (
              <li
                key={i}
                className="flex gap-3 border-b border-border p-4 md:border-b-0 md:border-r last:border-r-0"
              >
                <span className="font-mono text-xs text-primary">0{i + 1}</span>
                {s}
              </li>
            ))}
          </ol>
        </div>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
          <section className="border border-border bg-card p-5">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">Daily signal</h2>
              <span className="font-mono text-[10px] uppercase text-muted-foreground">
                {o?.daily.length ?? 0} days
              </span>
            </div>
            {ov.isLoading ? (
              <Skeleton className="h-44 w-full" />
            ) : (
              <DailyBars daily={o?.daily ?? []} />
            )}
          </section>
          <ActivityPreview query={act} />
        </div>
      )}

      {!empty && (
        <section className="border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="font-display text-lg font-bold">Recent messages</h2>
            <Link
              href="/emails"
              data-testid="link-all-emails"
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              All emails <ArrowUpRight className="size-3" />
            </Link>
          </div>
          {msgs.isLoading ? (
            <div className="space-y-2 p-5">
              {[0, 1, 2].map((i) => (
                <Skeleton key={i} className="h-9" />
              ))}
            </div>
          ) : msgs.isError ? (
            <div className="p-5">
              <ErrorState
                error={errorText(msgs.error)}
                onRetry={() => msgs.refetch()}
              />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {(msgs.data ?? []).slice(0, 5).map((m) => (
                <li key={m.id}>
                  <Link
                    href={`/emails/${m.id}`}
                    data-testid={`row-recent-${m.id}`}
                    className="flex min-w-0 flex-col gap-2 px-4 py-3 hover:bg-muted/50 sm:px-5 lg:flex-row lg:items-center lg:gap-4"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                      <Avatar name={m.recipientName} email={m.recipientEmail} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">
                          {m.subject}
                        </div>
                        <div className="truncate text-xs text-muted-foreground">
                          {m.recipientName || m.recipientEmail}
                        </div>
                      </div>
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground">
                        {ago(m.lastActivityAt ?? m.sentAt ?? m.createdAt)}
                      </span>
                    </div>
                    <div className="flex min-w-0 flex-wrap items-center gap-2 pl-11 lg:pl-0">
                      {m.deliverySource !== 'gmail' && m.status !== 'sent' && (
                        <StatusPill status={m.status} />
                      )}
                      <MessageEngagement m={m} />
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Caveat>
        <strong>How to read these numbers.</strong> Apple Mail Privacy
        Protection and Gmail's image proxy can preload or cache the pixel,
        inflating or hiding pixel-load counts. Security scanners can follow
        links before a human does; those are flagged as automated in Activity.
        Replies are detected by standard Message-ID reference headers during
        Gmail sync, from any recipient mail service, within your 100 most recent
        received messages of the last 30 days. Pixel totals include measured
        image requests only, never inferred reads from link requests or replies; 0 does
        not mean unread. Bounces aren't tracked.
      </Caveat>
    </div>
  );
}
