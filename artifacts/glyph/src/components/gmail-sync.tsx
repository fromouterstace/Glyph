import { RefreshCw } from 'lucide-react';
import { useSyncNativeMessages } from '@workspace/api-client-react';
import { errorText, useInvalidateAll, useSession } from '@/lib/glyph';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export const GMAIL_URL = 'https://mail.google.com';

export function SyncGmailButton({ className, label = 'Sync Gmail status', disabled }: { className?: string; label?: string; disabled?: boolean }) {
  const { isSignedIn } = useSession();
  const sync = useSyncNativeMessages();
  const invalidate = useInvalidateAll();
  const { toast } = useToast();
  const run = () =>
    sync.mutate(undefined, {
      onSuccess: (r) => {
        invalidate();
        toast({ title: r.confirmed ? `${r.confirmed} confirmed in Gmail Sent` : 'No new sends confirmed', description: `${r.pending} still awaiting Gmail send.` });
      },
      onError: (e) => toast({ title: 'Sync failed', description: errorText(e), variant: 'destructive' }),
    });
  return (
    <button type="button" data-testid="button-sync-gmail" disabled={!isSignedIn || disabled || sync.isPending} onClick={run}
      className={cn('inline-flex items-center gap-1.5 rounded-sm border border-border bg-card px-3 py-1.5 text-sm font-medium hover:border-foreground/40 disabled:opacity-40', className)}>
      <RefreshCw className={cn('size-3.5', sync.isPending && 'animate-spin')} /> {sync.isPending ? 'Checking Sent...' : label}
    </button>
  );
}
