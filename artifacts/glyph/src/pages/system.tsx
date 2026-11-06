import { useUser } from '@clerk/react';
import {
  Eye,
  LogIn,
  Mail,
  MessageSquareReply,
  MousePointerClick,
  RefreshCw,
  ShieldCheck,
  Users,
} from 'lucide-react';
import {
  getGetSystemAccessQueryKey,
  useGetSystemAccess,
  useGetSystemSummary,
  type SystemSummary,
} from '@workspace/api-client-react';
import { Link } from 'wouter';
import { ErrorState, SectionHead } from '@/components/bits';
import { stamp } from '@/lib/glyph';

const numberFormat = new Intl.NumberFormat();

export default function SystemPage() {
  const { user } = useUser();
  const access = useGetSystemAccess({
    query: {
      retry: false,
      staleTime: 60_000,
      queryKey: [...getGetSystemAccessQueryKey(), user?.id ?? 'signed-out'],
    },
  });

  if (access.isPending) {
    return (
      <div className="p-6 text-sm text-muted-foreground" role="status">
        Checking system access…
      </div>
    );
  }
  if (access.isError) {
    return (
      <ErrorState
        error="System access could not be verified."
        onRetry={() => void access.refetch()}
      />
    );
  }
  if (!access.data?.isSystemAdmin) {
    return (
      <section className="max-w-xl space-y-3 border border-border bg-card p-6">
        <h1 className="font-display text-2xl font-extrabold">
          System access restricted
        </h1>
        <p className="text-sm text-muted-foreground">
          This account is not authorized to view system metrics.
        </p>
        <Link
          className="text-sm font-semibold text-primary underline"
          href="/app"
        >
          Return to Signals
        </Link>
      </section>
    );
  }

  return <AdminSystemDashboard />;
}

function AdminSystemDashboard() {
  const summary = useGetSystemSummary({
    query: { refetchInterval: 30_000 },
  });

  if (summary.isError) {
    return (
      <div className="space-y-4">
        <SectionHead kicker="Administration" title="System" />
        <ErrorState
          error="System metrics could not be loaded."
          onRetry={() => void summary.refetch()}
        />
      </div>
    );
  }

  return (
    <div className="space-y-7">
      <SectionHead
        kicker="Administration"
        title="System"
        right={
          <button
            type="button"
            onClick={() => void summary.refetch()}
            disabled={summary.isFetching}
            className="inline-flex items-center gap-2 rounded-sm border border-border bg-card px-3 py-2 text-sm font-medium hover:border-foreground/40 disabled:opacity-50"
          >
            <RefreshCw
              className={`size-4 ${summary.isFetching ? 'animate-spin' : ''}`}
            />
            Refresh
          </button>
        }
      />
      <SystemMetricCards data={summary.data} />
      <SystemSecurityPanels data={summary.data} />
      <p className="text-xs text-muted-foreground">
        Sign-in counts are unique Clerk sessions observed by Glyph after the
        account opens the app. They do not include sign-ins that never reach
        Glyph.
      </p>
    </div>
  );
}

function SystemMetricCards({ data }: { data?: SystemSummary }) {
  const cards = [
    { label: 'Registered users', value: data?.usersTotal, icon: Users },
    {
      label: 'Observed sign-in sessions',
      value: data?.loginSessionsTotal,
      detail: `${numberFormat.format(data?.loginSessionsLast24Hours ?? 0)} in 24 hours`,
      icon: LogIn,
    },
    { label: 'Emails sent', value: data?.emailsSentTotal, icon: Mail },
    {
      label: 'Emails sent in 30 days',
      value: data?.emailsSentLast30Days,
      icon: Mail,
    },
    { label: 'Pixel loads', value: data?.pixelLoadsTotal, icon: Eye },
    {
      label: 'Link clicks',
      value: data?.linkClicksTotal,
      icon: MousePointerClick,
    },
    { label: 'Replies', value: data?.repliesTotal, icon: MessageSquareReply },
  ];

  return (
    <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {cards.map(({ label, value, detail, icon: Icon }) => (
        <article key={label} className="border border-border bg-card p-4">
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <span>{label}</span>
            <Icon className="size-4" aria-hidden="true" />
          </div>
          <div className="mt-3 font-mono text-3xl font-semibold">
            {data ? numberFormat.format(value ?? 0) : '—'}
          </div>
          {detail && (
            <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
          )}
        </article>
      ))}
    </section>
  );
}

function SystemSecurityPanels({ data }: { data?: SystemSummary }) {
  return (
    <section className="grid gap-4 lg:grid-cols-2">
      <article className="border border-border bg-card p-5">
        <div className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="size-4 text-primary" />
          Security
        </div>
        <p className="mt-3 text-sm text-muted-foreground">
          Account APIs require sign-in and owner checks. System metrics require
          a verified email on the server-side admin allowlist. No email bodies,
          recipient lists, IP addresses, or full user-agent strings are shown
          here.
        </p>
        <div className="mt-4 border-t border-border pt-3">
          <div className="text-xs text-muted-foreground">
            Sessions that attempted to access the admin summary without
            authorization
          </div>
          <div className="mt-1 font-mono text-2xl">
            {data ? numberFormat.format(data.adminAccessDeniedSessions) : '—'}
          </div>
        </div>
      </article>

      <article className="border border-border bg-card p-5">
        <div className="font-semibold">Recent denied admin access</div>
        {!data ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Loading security summary…
          </p>
        ) : data.recentAdminAccessDenials.length ? (
          <ul className="mt-3 divide-y divide-border">
            {data.recentAdminAccessDenials.map((at) => (
              <li
                key={at}
                className="flex items-center justify-between gap-3 py-2 text-sm"
              >
                <span>Unauthorized admin summary request</span>
                <time
                  dateTime={at}
                  className="shrink-0 font-mono text-xs text-muted-foreground"
                >
                  {stamp(at)}
                </time>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">
            No authenticated denied admin attempts recorded.
          </p>
        )}
      </article>
    </section>
  );
}
