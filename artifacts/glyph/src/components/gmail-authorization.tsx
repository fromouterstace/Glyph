import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  useGetGmailAuthorization,
  useBeginGmailAuthorization,
  useDisconnectGmail,
  getGetGmailAuthorizationQueryKey,
  getGetConnectionQueryKey,
  type GmailAuthorization as GmailAuthorizationStatus,
} from '@workspace/api-client-react';
import { SyncGmailButton } from './gmail-sync';
import { errorText } from '@/lib/glyph';

const buttonClass =
  'rounded-sm border border-border px-3 py-2 text-sm font-medium disabled:opacity-50';
const outcomes: Record<string, string> = {
  connected: 'Gmail connected to your Glyph account.',
  denied:
    'Gmail authorization was cancelled. Your previous connection was not changed.',
  failed:
    'Gmail authorization did not complete. Use a Gmail address verified on your Glyph account, approve both requested permissions, and try again.',
};

export function GmailAuthorization() {
  const status = useGetGmailAuthorization();
  const begin = useBeginGmailAuthorization();
  const disconnect = useDisconnectGmail();
  const cache = useQueryClient();
  const [confirm, setConfirm] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const busy = begin.isPending || disconnect.isPending;
  const outcome =
    new URLSearchParams(window.location.search).get('gmail') ?? '';
  const connect = async () => {
    setMessage(null);
    try {
      const result = await begin.mutateAsync();
      const url = new URL(result.authorizationUrl);
      if (url.origin !== 'https://accounts.google.com')
        throw new Error('The Gmail authorization URL is invalid.');
      window.location.assign(url.toString());
    } catch (error) {
      setMessage(errorText(error));
    }
  };
  const remove = async () => {
    setMessage(null);
    try {
      const result = await disconnect.mutateAsync();
      setConfirm(false);
      setMessage(
        result.revocationConfirmed
          ? 'Gmail disconnected. Saved messages and tracking history remain available.'
          : 'Disconnected from Glyph. Google revocation could not be confirmed; remove Glyph access in your Google Account security settings too.',
      );
      await Promise.all([
        cache.invalidateQueries({
          queryKey: getGetGmailAuthorizationQueryKey(),
        }),
        cache.invalidateQueries({ queryKey: getGetConnectionQueryKey() }),
      ]);
    } catch (error) {
      setMessage(errorText(error));
    }
  };
  const data = status.data;
  const elsewhere =
    !!data?.connectOrigin && data.connectOrigin !== window.location.origin;
  return (
    <section
      className="space-y-4 border border-border bg-card p-5"
      data-testid="section-gmail-authorization"
    >
      <div>
        <h2 className="text-lg font-semibold">Your Gmail connection</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Connect one Gmail account to your Glyph account. Sending, Sent checks,
          replies and extension access use your connection—not another user's
          mailbox.
        </p>
      </div>
      {status.isLoading && <p role="status">Checking your Gmail connection…</p>}
      {status.isError && (
        <div role="alert" className="text-sm text-destructive">
          Could not check Gmail.{' '}
          <button
            type="button"
            className="underline"
            onClick={() => void status.refetch()}
          >
            Retry
          </button>
        </div>
      )}
      {data && (
        <AuthorizationDetails
          data={data}
          elsewhere={elsewhere}
          busy={busy}
          confirm={confirm}
          onConnect={() => void connect()}
          onConfirm={() => setConfirm(true)}
          onCancel={() => setConfirm(false)}
          onRemove={() => void remove()}
        />
      )}
      {(message || outcomes[outcome]) && (
        <p role="status" className="text-sm">
          {message || outcomes[outcome]}
        </p>
      )}
    </section>
  );
}

type DetailsProps = {
  data: GmailAuthorizationStatus;
  elsewhere: boolean;
  busy: boolean;
  confirm: boolean;
  onConnect: () => void;
  onConfirm: () => void;
  onCancel: () => void;
  onRemove: () => void;
};

function AuthorizationDetails({
  data,
  elsewhere,
  busy,
  confirm,
  onConnect,
  onConfirm,
  onCancel,
  onRemove,
}: DetailsProps) {
  return (
    <div className="space-y-3 text-sm">
      <p className="font-medium">
        {data.connected
          ? `Connected: ${data.email}`
          : 'Gmail is not connected.'}
      </p>
      {data.kind === 'legacy' && (
        <p className="text-muted-foreground">
          Your existing project connection is still active. Connect Gmail below
          to move this mailbox to your personal authorization.
        </p>
      )}
      {!data.configured && (
        <p role="alert">
          Individual Gmail authorization is not configured. The app
          administrator must finish Google OAuth setup.
        </p>
      )}
      {data.configured && elsewhere && (
        <a
          className="font-medium text-primary underline"
          href={`${data.connectOrigin}/gmail`}
        >
          Open published Glyph to connect your Gmail
        </a>
      )}
      <p className="text-xs text-muted-foreground">
        Google asks for permission to read Gmail for sent/reply checks and send
        mail from the web composer. Use an address verified on your Glyph
        account. Reconnect the same mailbox; switching mailboxes on an existing
        account is not supported.
      </p>
      <div className="flex flex-wrap gap-2">
        {data.configured && !elsewhere && (
          <button
            type="button"
            className={buttonClass}
            onClick={onConnect}
            disabled={busy}
          >
            {busy
              ? 'Please wait…'
              : data.connected
                ? 'Reconnect Gmail'
                : 'Connect Gmail'}
          </button>
        )}
        {data.kind === 'personal' && data.connected && !confirm && (
          <button
            type="button"
            className={buttonClass}
            disabled={busy}
            onClick={onConfirm}
          >
            Disconnect Gmail
          </button>
        )}
        {data.connected && <SyncGmailButton />}
      </div>
      {confirm && (
        <div className="space-y-3 border border-border p-3">
          <p>
            Disconnect your Gmail? This stops future sends and syncs, but
            preserves saved data and existing tracking links. A request already
            in flight may finish.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={onRemove}
            >
              Confirm disconnect
            </button>
            <button
              type="button"
              className={buttonClass}
              disabled={busy}
              onClick={onCancel}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
