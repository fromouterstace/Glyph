import { Pencil, Send, Trash2 } from 'lucide-react';
import type { Message } from '@workspace/api-client-react';
import { Caveat } from '@/components/bits';
import { GMAIL_URL, SyncGmailButton } from '@/components/gmail-sync';

export function MessageWorkflowActions({
  message,
  canMutate,
  sendPending,
  onEdit,
  onDelete,
  onConfirmSend,
  onCheckSend,
}: {
  message: Message;
  canMutate: boolean;
  sendPending: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onConfirmSend: () => void;
  onCheckSend: () => void;
}) {
  const native = message.deliverySource === 'gmail';
  const awaiting = native && message.status !== 'sent';
  const editable = !native && ['draft', 'failed'].includes(message.status);
  const uncertain =
    !native && ['uncertain', 'sending'].includes(message.status);

  return (
    <>
      {awaiting && (
        <div className="mt-4 space-y-3">
          <Caveat>
            Drafted in Gmail with Add glyph. It counts as sent only after Glyph
            finds its marker in your Gmail Sent folder. Send it from Gmail, then
            sync.
          </Caveat>
          <div className="flex flex-wrap gap-2">
            <SyncGmailButton disabled={!canMutate} />
            <a
              href={GMAIL_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center rounded-sm border border-border px-3 py-1.5 text-sm hover:border-foreground/40"
            >
              Open Gmail
            </a>
          </div>
        </div>
      )}
      {editable && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            data-testid="button-edit-draft"
            disabled={!canMutate}
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-sm hover:border-foreground/40 disabled:opacity-40"
          >
            <Pencil className="size-3.5" /> Edit
          </button>
          <button
            data-testid="button-send-draft"
            disabled={!canMutate || message.status === 'failed'}
            onClick={onConfirmSend}
            className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            <Send className="size-3.5" /> Send
          </button>
          <button
            data-testid="button-delete-draft"
            disabled={!canMutate}
            onClick={onDelete}
            className="ml-auto inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-40"
          >
            <Trash2 className="size-3.5" /> Delete
          </button>
        </div>
      )}
      {!native && !canMutate && message.status === 'draft' && (
        <p className="mt-2 text-xs text-muted-foreground">
          Sample drafts are read-only. Sign in with the Gmail owner account to
          edit or send.
        </p>
      )}
      {!native && message.status === 'failed' && (
        <p className="mt-2 text-xs text-destructive">
          Gmail rejected the send. Edit and save this draft before trying again.
        </p>
      )}
      {uncertain && (
        <div className="mt-4 space-y-3">
          <Caveat>
            Gmail has not confirmed this send. Check your Sent folder before
            creating another email to avoid a duplicate.
          </Caveat>
          <button
            type="button"
            disabled={!canMutate || sendPending}
            onClick={onCheckSend}
            className="rounded-sm border border-border px-3 py-1.5 text-sm disabled:opacity-40"
          >
            Check Gmail send status
          </button>
        </div>
      )}
    </>
  );
}
