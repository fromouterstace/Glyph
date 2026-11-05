import { RefreshCw } from 'lucide-react';
import { useSyncNativeMessages } from '@workspace/api-client-react';
import { errorText, useInvalidateAll, useSession } from '@/lib/glyph';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export const GMAIL_URL = 'https://mail.google.com';

export function SyncGmailButton({
  className,
  label = 'Sync Gmail status',
  disabled,
}: {
  className?: string;
  label?: string;
  disabled?: boolean;
}) {
  const { isSignedIn } = useSession();
  const sync = useSyncNativeMessages();
  const invalidate = useInvalidateAll();
  const { toast } = useToast();
  const run = () =>
    sync.mutate(undefined, {
      onSuccess: (r) => {
        invalidate();
        const sends = r.confirmed
          ? `${r.confirmed} confirmed in Gmail Sent`
          : 'No new sends confirmed';
        const pending = `${r.pending} still awaiting Gmail send.`;
        if (r.replyCheckError) {
          toast({
            title: `${sends}. Reply check failed`,
            description: `${pending} Replies could not be checked: ${r.replyCheckError}`,
            variant: 'destructive',
          });
          return;
        }
        const replies = r.repliesDetected
          ? `${r.repliesDetected} new repl${r.repliesDetected === 1 ? 'y' : 'ies'} detected.`
          : 'No new replies detected.';
        const partial = r.replyCheckPartial
          ? ' Partial check: only the 100 most recent received messages of the last 30 days were scanned; older replies may be missed.'
          : '';
        toast({ title: sends, description: `${pending} ${replies}${partial}` });
      },
      onError: (e) =>
        toast({
          title: 'Sync failed',
          description: errorText(e),
          variant: 'destructive',
        }),
    });
  return (
    <button
      type="button"
      data-testid="button-sync-gmail"
      disabled={!isSignedIn || disabled || sync.isPending}
      onClick={run}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border border-border bg-card px-3 py-1.5 text-sm font-medium hover:border-foreground/40 disabled:opacity-40',
        className,
      )}
    >
      <RefreshCw className={cn('size-3.5', sync.isPending && 'animate-spin')} />{' '}
      {sync.isPending ? 'Checking Sent...' : label}
    </button>
  );
}
