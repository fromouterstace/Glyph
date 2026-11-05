import { CheckCircle2, CircleSlash } from 'lucide-react';
import { Link } from 'wouter';
import { useGetConnection } from '@workspace/api-client-react';
import { ErrorState } from '@/components/bits';
import { SyncGmailButton } from '@/components/gmail-sync';
import { Skeleton } from '@/components/ui/skeleton';
import { errorText } from '@/lib/glyph';

export function GmailConnection({ locked }: { locked: boolean }) {
  const connection = useGetConnection();
  if (connection.isLoading)
    return (
      <div className="p-5">
        <Skeleton className="h-16" />
      </div>
    );
  if (connection.isError)
    return (
      <div className="p-5">
        <ErrorState
          error={errorText(connection.error)}
          onRetry={() => connection.refetch()}
        />
      </div>
    );
  if (!connection.data) return null;
  const { connected, authorized, email, message } = connection.data;
  const ready = connected && authorized;
  const status = !connected
    ? 'Gmail not connected'
    : authorized
      ? 'Connected and authorized to send'
      : 'Gmail connected, but not to this account';
  return (
    <div className="p-5">
      <div className="flex gap-4">
        <span
          className={`flex size-10 shrink-0 items-center justify-center rounded-sm ${ready ? 'bg-accent text-accent-foreground' : 'bg-secondary text-muted-foreground'}`}
        >
          {ready ? (
            <CheckCircle2 className="size-5" />
          ) : (
            <CircleSlash className="size-5" />
          )}
        </span>
        <div className="space-y-1 text-sm">
          <div className="font-medium" data-testid="text-connection-status">
            {status}
          </div>
          {email && (
            <div
              className="font-mono text-xs"
              data-testid="text-connection-email"
            >
              {email}
            </div>
          )}
          <p
            className="text-muted-foreground"
            data-testid="text-connection-message"
          >
            {message}
          </p>
          <p className="text-xs text-muted-foreground">
            To send, sign in with a verified account whose email matches the
            connected Gmail mailbox. Other accounts see only their own (empty)
            data and cannot send.
          </p>
          <div className="flex flex-wrap items-center gap-3 pt-2">
            <SyncGmailButton disabled={locked} />
            <Link
              href="/gmail"
              className="text-xs font-semibold text-primary hover:underline"
            >
              Gmail extension setup
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
