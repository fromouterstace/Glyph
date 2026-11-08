import { RefreshCw } from 'lucide-react';
import { useSyncNativeMessages } from '@workspace/api-client-react';
import { errorText, useInvalidateAll, useSession } from '@/lib/glyph';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { PUBLISHED_GLYPH_ORIGIN } from '@/lib/tracking-origin';

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
          const paused = r.replyCheckError.includes('temporarily rate-limited');
          toast({
            title: `${sends}. Reply checks ${paused ? 'paused' : 'failed'}`,
            description: `${pending} Replies could not be checked: ${r.replyCheckError}`,
            variant: paused ? 'default' : 'destructive',
          });
          return;
        }
        const replies = r.repliesDetected
          ? `${r.repliesDetected} new repl${r.repliesDetected === 1 ? 'y' : 'ies'} detected.`
          : 'No new replies detected.';
        const partial = r.replyCheckPartial
          ? ' Partial check: headers are processed in batches across syncs, covering up to the 100 most recent received messages of the last 30 days. Some replies remain unchecked.'
          : '';
        toast({ title: sends, description: `${pending} ${replies}${partial}` });
      },
      onError: (e) => {
        const description = errorText(e);
        const paused = description.includes('temporarily rate-limited');
        toast({
          title: paused ? 'Gmail checks paused' : 'Sync failed',
          description,
          variant: paused ? 'default' : 'destructive',
        });
      },
    });
  if (import.meta.env.DEV)
    return (
      <a
        href={`${PUBLISHED_GLYPH_ORIGIN}/emails`}
        target="_blank"
        rel="noreferrer"
        data-testid="link-published-gmail-activity"
        className={cn(
          'inline-flex items-center gap-1.5 rounded-sm border border-border bg-card px-3 py-1.5 text-sm font-medium hover:border-foreground/40',
          className,
        )}
        title="The Gmail extension connects to published Glyph. Its messages and connection are separate from Preview."
      >
        View published Gmail activity
      </a>
    );
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
