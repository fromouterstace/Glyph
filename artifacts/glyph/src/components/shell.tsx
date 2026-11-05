import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { useClerk, useUser } from '@clerk/react';
import {
  LayoutGrid,
  Mail,
  Radio,
  Settings2,
  Puzzle,
  LogOut,
  LogIn,
  Menu,
  X,
} from 'lucide-react';
import {
  useListActivity,
  useGetSettings,
  useGetOverview,
  getListActivityQueryKey,
  getGetOverviewQueryKey,
} from '@workspace/api-client-react';
import { cn } from '@/lib/utils';
import { basePath, usePoll, useSession } from '@/lib/glyph';
import { GlyphMark } from '@/components/bits';
import { useToast } from '@/hooks/use-toast';
import { PUBLISHED_GLYPH_ORIGIN } from '@/lib/tracking-origin';

function AlertWatcher() {
  const poll = usePoll();
  const activityParams = { limit: 100, offset: 0 };
  const { data: activity } = useListActivity(activityParams, {
    query: {
      refetchInterval: poll,
      queryKey: getListActivityQueryKey(activityParams),
    },
  });
  const { data: settings } = useGetSettings();
  const { toast } = useToast();
  const seen = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (!activity?.items) return;
    if (seen.current === null) {
      seen.current = new Set(activity.items.map((a) => a.id));
      return;
    }
    const fresh = activity.items.filter((a) => !seen.current!.has(a.id));
    fresh.forEach((a) => seen.current!.add(a.id));
    if (!settings || settings.readOnly) return;
    const enabled = {
      open: settings.notifyOpens,
      click: settings.notifyClicks,
      reply: settings.notifyReplies ?? true,
      sent: false,
    };
    const labels = {
      open: 'Pixel-load signal',
      click: 'Tracked-link signal',
      reply: 'Reply received',
      sent: 'Sent',
    };
    for (const a of fresh) {
      if (!enabled[a.type]) continue;
      const label = labels[a.type];
      const title = `${label}${a.automated ? ' (likely automated)' : ''}`;
      const description = `${a.recipientName || a.recipientEmail} · ${a.subject}`;
      toast({ title, description });
      if (
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted'
      ) {
        try {
          new Notification(`Glyph: ${title}`, { body: description });
        } catch {
          /* ignore */
        }
      }
    }
  }, [activity, settings, toast]);
  return null;
}

const nav = [
  { href: '/app', label: 'Signals', icon: LayoutGrid, publicHref: '/' },
  { href: '/gmail', label: 'Gmail', icon: Puzzle },
  { href: '/emails', label: 'Emails', icon: Mail },
  { href: '/activity', label: 'Activity', icon: Radio, badge: true },
  { href: '/settings', label: 'Settings', icon: Settings2 },
];

export function Shell({ children }: { children: ReactNode }) {
  const [loc] = useLocation();
  const { isSignedIn } = useSession();
  const { signOut } = useClerk();
  const { user } = useUser();
  const poll = usePoll();
  const { data: ov } = useGetOverview({
    query: { refetchInterval: poll, queryKey: getGetOverviewQueryKey() },
  });
  const readOnly = ov?.readOnly ?? !isSignedIn;

  const side = (
    <div className="flex h-full flex-col">
      <Link
        href={isSignedIn ? '/app' : '/'}
        className="flex items-center gap-2.5 px-5 py-5"
        data-testid="link-home"
      >
        <GlyphMark live={isSignedIn} className="text-sidebar-foreground" />
        <span className="font-display text-xl font-extrabold tracking-tight text-sidebar-accent-foreground">
          glyph
        </span>
      </Link>
      <nav className="mt-2 flex flex-col gap-0.5 px-3">
        {nav.map((n) => {
          const href = !isSignedIn && n.publicHref ? n.publicHref : n.href;
          const active =
            loc === href || (n.href !== '/app' && loc.startsWith(n.href));
          return (
            <Link
              key={n.href}
              href={href}
              data-testid={`link-nav-${n.label.toLowerCase()}`}
              className={cn(
                'group flex items-center gap-3 rounded-sm px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-sidebar-accent text-sidebar-accent-foreground'
                  : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground',
              )}
            >
              <span
                className={cn(
                  'h-4 w-[2px] rounded-full transition-colors',
                  active ? 'bg-sidebar-primary' : 'bg-transparent',
                )}
              />
              <n.icon className="size-4" />
              {n.label}
              {n.badge && !!ov?.unreadCount && (
                <span
                  className="ml-auto rounded-sm bg-sidebar-primary px-1.5 font-mono text-[10px] text-sidebar-primary-foreground"
                  data-testid="badge-unread"
                >
                  {ov.unreadCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      <div className="mt-auto space-y-3 p-4">
        <div className="rounded-sm border border-sidebar-border p-3 text-[11px] leading-relaxed text-sidebar-foreground/60">
          A glyph is a 1x1 pixel. It reports when an image loaded, not when a
          human read. Treat signals as hints.
        </div>
        {isSignedIn ? (
          <div className="flex items-center gap-2 rounded-sm bg-sidebar-accent px-3 py-2.5">
            <div className="min-w-0 flex-1">
              <div
                className="truncate text-xs font-medium text-sidebar-accent-foreground"
                data-testid="text-user-email"
              >
                {user?.primaryEmailAddress?.emailAddress ?? 'Signed in'}
              </div>
              <div className="font-mono text-[10px] text-sidebar-foreground/50">
                {readOnly ? 'read-only' : 'live session'}
              </div>
            </div>
            <button
              data-testid="button-signout"
              onClick={() => signOut({ redirectUrl: basePath || '/' })}
              className="rounded-sm p-1.5 text-sidebar-foreground/70 hover:bg-sidebar hover:text-sidebar-accent-foreground"
              aria-label="Sign out"
            >
              <LogOut className="size-4" />
            </button>
          </div>
        ) : (
          <Link
            href="/sign-in"
            data-testid="link-signin-side"
            className="flex items-center justify-center gap-2 rounded-sm bg-sidebar-primary px-3 py-2.5 text-sm font-semibold text-sidebar-primary-foreground hover:opacity-90"
          >
            <LogIn className="size-4" /> Sign in
          </Link>
        )}
      </div>
    </div>
  );

  return (
    <div className="grain min-h-[100dvh] bg-background">
      {isSignedIn && <AlertWatcher key={user?.id} />}
      <aside className="fixed inset-y-0 left-0 hidden w-60 bg-sidebar md:block">
        {side}
      </aside>
      <MobileNavigation key={loc} side={side} isSignedIn={isSignedIn} />
      <main className="md:pl-60">
        {import.meta.env.DEV && (
          <div
            role="note"
            className="border-b border-primary/30 bg-primary/[0.06] px-4 py-3 text-sm md:px-8"
            data-testid="banner-development"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <strong>This is the development app.</strong>
              <a
                href={`${PUBLISHED_GLYPH_ORIGIN}/gmail`}
                target="_blank"
                rel="noreferrer"
                className="font-semibold text-primary underline underline-offset-4"
              >
                Open published Glyph
              </a>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              For real-send testing, sign in to published Glyph and reconnect
              the Gmail extension there. Emails prepared here keep development
              tracking links; publishing does not update already-sent emails.
              Keep the connection tab and tracking links in the same
              environment.
            </p>
          </div>
        )}
        {readOnly && (
          <div
            className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-b border-dashed border-primary/40 bg-primary/[0.06] px-4 py-2 text-center text-xs"
            data-testid="banner-readonly"
          >
            <span className="font-mono uppercase tracking-wider text-primary">
              Read-only preview
            </span>
            <span className="text-foreground/70">
              Account activity loads from PostgreSQL after you sign in.
            </span>
            {!isSignedIn && (
              <Link
                href="/sign-in"
                className="font-semibold text-primary underline-offset-4 hover:underline"
              >
                Sign in to view your saved email activity
              </Link>
            )}
          </div>
        )}
        <div className="mx-auto max-w-[1240px] px-4 py-6 md:px-8 md:py-10">
          {children}
        </div>
      </main>
    </div>
  );
}

function MobileNavigation({
  side,
  isSignedIn,
}: {
  side: ReactNode;
  isSignedIn: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <div className="sticky top-0 z-40 flex items-center justify-between bg-sidebar px-4 py-3 md:hidden">
        <Link
          href={isSignedIn ? '/app' : '/'}
          className="flex items-center gap-2 text-sidebar-foreground"
        >
          <GlyphMark className="size-6" />{' '}
          <span className="font-display text-lg font-extrabold text-sidebar-accent-foreground">
            glyph
          </span>
        </Link>
        <button
          data-testid="button-menu"
          aria-label={open ? 'Close navigation' : 'Open navigation'}
          aria-expanded={open}
          onClick={() => setOpen(!open)}
          className="text-sidebar-foreground"
        >
          {open ? <X /> : <Menu />}
        </button>
      </div>
      {open && (
        <div className="fixed inset-0 top-[52px] z-30 bg-sidebar md:hidden">
          {side}
        </div>
      )}
    </>
  );
}
