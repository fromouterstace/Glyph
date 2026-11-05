import { Send, Eye, MousePointerClick, Reply } from 'lucide-react';
import type { Message } from '@workspace/api-client-react';
import { cn } from '@/lib/utils';

type Kind = 'sent' | 'open' | 'click' | 'reply';
const META: Record<Kind, { icon: typeof Send; label: string; on: string }> = {
  sent: { icon: Send, label: 'Sent', on: 'bg-foreground/[0.07] text-foreground border-foreground/20' },
  open: { icon: Eye, label: 'Opened', on: 'bg-[hsl(var(--chart-2)/0.12)] text-[hsl(var(--chart-2))] border-[hsl(var(--chart-2)/0.35)]' },
  click: { icon: MousePointerClick, label: 'Clicked', on: 'bg-primary/10 text-primary border-primary/30' },
  reply: { icon: Reply, label: 'Replied', on: 'bg-accent text-accent-foreground border-[hsl(174_30%_76%)]' },
};

/** Each signal shown independently. Zero = no signal detected, not "never opened". */
export function MessageEngagement({ m, className, compact }: { m: Message; className?: string; compact?: boolean }) {
  const native = m.deliverySource === 'gmail';
  const sent = m.status === 'sent';
  if (!sent && native)
    return <span className={cn('inline-flex items-center gap-1.5 rounded-sm bg-[hsl(40_70%_90%)] px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-[hsl(32_70%_28%)]', className)} data-testid={`engagement-awaiting-${m.id}`}>Awaiting Gmail send</span>;
  const items: { k: Kind; v: number | null; off?: boolean }[] = [
    { k: 'sent', v: sent ? 1 : 0 },
    { k: 'open', v: m.trackOpens ? m.opens : null, off: !m.trackOpens },
    { k: 'click', v: m.trackClicks ? m.clicks : null, off: !m.trackClicks },
    { k: 'reply', v: m.replies ?? 0 },
  ];
  return (
    <ul className={cn('flex min-w-0 flex-wrap gap-1', className)} data-testid={`engagement-${m.id}`}>
      {items.map(({ k, v, off }) => {
        const M = META[k];
        const hit = !!v && v > 0;
        const title = off ? `${M.label}: tracking off` : k === 'sent' ? (hit ? 'Sent' : 'Not sent') : hit ? `${M.label}: ${v} signal${v === 1 ? '' : 's'}` : `${M.label}: no signal detected`;
        return (
          <li key={k} title={title} aria-label={title} data-testid={`engagement-${k}-${m.id}`}
            className={cn('inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[10px] tabular-nums leading-none',
              hit ? M.on : 'border-dashed border-border text-muted-foreground/80')}>
            <M.icon className="size-3 shrink-0" />
            {!compact && <span className="uppercase tracking-wider">{M.label}</span>}
            {k !== 'sent' && <span>{off ? 'off' : v}</span>}
            {k === 'sent' && compact && <span>{hit ? 'yes' : 'no'}</span>}
          </li>
        );
      })}
    </ul>
  );
}
