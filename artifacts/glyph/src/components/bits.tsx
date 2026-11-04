import type { ReactNode } from 'react';
import { Link } from 'wouter';
import { AlertTriangle, RotateCw, Info } from 'lucide-react';
import type { MessageStatus, DailyStat } from '@workspace/api-client-react';
import { cn } from '@/lib/utils';
import { initials } from '@/lib/glyph';

export function GlyphMark({ className, live }: { className?: string; live?: boolean }) {
  return (
    <span className={cn('relative inline-flex size-7 items-center justify-center', className)}>
      <span className="absolute inset-[3px] rounded-[3px] border-2 border-current" />
      <span className="absolute bottom-[1px] right-[1px] size-[9px] rounded-[2px] bg-primary">
        {live && <span className="absolute inset-0 rounded-[2px] bg-primary pulse-ring" />}
      </span>
    </span>
  );
}

const statusStyle: Record<MessageStatus, string> = {
  draft: 'bg-secondary text-secondary-foreground border-border',
  sending: 'bg-[hsl(40_70%_90%)] text-[hsl(32_70%_28%)] border-[hsl(40_60%_78%)]',
  sent: 'bg-accent text-accent-foreground border-[hsl(174_30%_76%)]',
  failed: 'bg-[hsl(350_70%_94%)] text-destructive border-[hsl(350_60%_84%)]',
  uncertain: 'bg-[hsl(40_70%_90%)] text-[hsl(32_70%_28%)] border-[hsl(40_60%_78%)]',
};
export function StatusPill({ status }: { status: MessageStatus }) {
  return (
    <span
      data-testid={`status-${status}`}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider',
        statusStyle[status],
      )}
    >
      <span className={cn('size-1.5 rounded-full bg-current', status === 'sending' && 'animate-pulse')} />
      {status}
    </span>
  );
}

export function DemoTag({ className }: { className?: string }) {
  return (
    <span
      data-testid="tag-demo"
      className={cn(
        'inline-flex items-center rounded-sm border border-dashed border-primary/60 bg-primary/5 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-primary',
        className,
      )}
    >
      Sample data
    </span>
  );
}

export function Avatar({ name, email, className }: { name: string; email: string; className?: string }) {
  return (
    <span
      className={cn(
        'inline-flex size-8 shrink-0 items-center justify-center rounded-sm bg-foreground font-mono text-[11px] font-medium text-background',
        className,
      )}
    >
      {initials(name, email)}
    </span>
  );
}

export function Stat({ label, value, hint, accent, delay = 0 }: { label: string; value: ReactNode; hint?: ReactNode; accent?: boolean; delay?: number }) {
  return (
    <div className="rise border-r border-b border-border p-4 md:p-5 last:border-r-0" style={{ animationDelay: `${delay}ms` }}>
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className={cn('font-display mt-2 text-3xl font-bold tabular-nums md:text-4xl', accent && 'text-primary')}>{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

export function DailyBars({ daily }: { daily: DailyStat[] }) {
  const max = Math.max(1, ...daily.map((d) => Math.max(d.sent, d.opens, d.clicks)));
  if (!daily.length)
    return <div className="flex h-40 items-center justify-center text-sm text-muted-foreground dotgrid">No sends in this window yet.</div>;
  return (
    <div>
      <div className="flex h-44 items-end gap-[3px] dotgrid px-1">
        {daily.map((d, i) => (
          <div key={d.date} className="group relative flex h-full flex-1 items-end gap-[1px]" data-testid={`bar-day-${d.date}`}>
            {(['sent', 'opens', 'clicks'] as const).map((k) => (
              <div
                key={k}
                className={cn(
                  'bar-grow flex-1 rounded-t-[1px]',
                  k === 'sent' && 'bg-foreground/80',
                  k === 'opens' && 'bg-[hsl(var(--chart-2))]',
                  k === 'clicks' && 'bg-primary',
                )}
                style={{ height: `${(d[k] / max) * 100}%`, animationDelay: `${i * 18}ms` }}
              />
            ))}
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-2 -translate-x-1/2 whitespace-nowrap rounded-sm bg-foreground px-2 py-1 font-mono text-[10px] text-background opacity-0 transition-opacity group-hover:opacity-100">
              {d.date} · {d.sent}s {d.opens}o {d.clicks}c
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-4 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        <Legend c="bg-foreground/80" l="Sent" />
        <Legend c="bg-[hsl(var(--chart-2))]" l="Open signals" />
        <Legend c="bg-primary" l="Click signals" />
      </div>
    </div>
  );
}
function Legend({ c, l }: { c: string; l: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn('size-2 rounded-[1px]', c)} />
      {l}
    </span>
  );
}

export function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 border border-destructive/30 bg-destructive/5 p-5" data-testid="state-error">
      <div className="flex items-center gap-2 text-sm font-medium text-destructive">
        <AlertTriangle className="size-4" /> Couldn't load this
      </div>
      <p className="text-sm text-muted-foreground">{error}</p>
      <button data-testid="button-retry" onClick={onRetry} className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-card px-3 py-1.5 text-xs font-medium hover:border-foreground/40">
        <RotateCw className="size-3.5" /> Retry
      </button>
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-14 text-center dotgrid" data-testid="state-empty">
      <GlyphMark className="size-10 text-foreground/70" />
      <h3 className="font-display text-xl font-bold">{title}</h3>
      <div className="max-w-sm text-sm text-muted-foreground">{body}</div>
      {action}
    </div>
  );
}

export function Caveat({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-2.5 border-l-2 border-[hsl(var(--chart-4))] bg-[hsl(40_70%_52%/0.08)] px-3 py-2.5 text-xs leading-relaxed text-foreground/80">
      <Info className="mt-0.5 size-3.5 shrink-0 text-[hsl(32_70%_38%)]" />
      <div>{children}</div>
    </div>
  );
}

export function SignInNudge({ what }: { what: string }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border border-dashed border-primary/50 bg-primary/5 px-4 py-3 text-sm">
      <span>You're viewing sample data. Sign in with the account that owns the connected Gmail to {what}.</span>
      <Link href="/sign-in" data-testid="link-signin-nudge" className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90">
        Sign in
      </Link>
    </div>
  );
}

export function SectionHead({ kicker, title, right }: { kicker: string; title: ReactNode; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-primary">{kicker}</div>
        <h1 className="font-display mt-1 text-3xl font-extrabold md:text-4xl">{title}</h1>
      </div>
      {right}
    </div>
  );
}
