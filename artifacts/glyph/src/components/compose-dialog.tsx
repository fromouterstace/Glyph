import { useState } from 'react';
import { useUser } from '@clerk/react';
import { Send, Save, Loader2 } from 'lucide-react';
import {
  useCreateMessage,
  useUpdateMessage,
  useSendMessage,
  type Message,
  type MessageInput,
  type Attachment,
} from '@workspace/api-client-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { ComposerBody, messageTooLong } from '@/components/composer-body';
import { composerAttachments, initialComposerForm } from '@/lib/composer-form';
import {
  initialRecipients,
  recipientInput,
  recipientError,
  type RecipientText,
} from '@/lib/composer-recipients';
import { ComposerRecipients, RecipientReview } from './composer-recipients';
import { useComposerDelivery } from '@/hooks/use-composer-delivery';
import {
  ComposerDeliveryNotice,
  ComposerDeliveryWarning,
} from './composer-delivery';
import {
  EmailAttachments,
  releaseUnusedAttachment,
} from '@/components/email-attachments';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { errorText, useInvalidateAll } from '@/lib/glyph';
import { Caveat } from '@/components/bits';

type ComposeDialogProps = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  message?: Message | null;
  onSaved?: (m: Message) => void;
};

export function ComposeDialog(props: ComposeDialogProps) {
  const { user, isLoaded } = useUser();
  if (!props.open) return null;
  const senderName =
    isLoaded && user
      ? user.fullName?.trim() ||
        [user.firstName, user.lastName].filter(Boolean).join(' ').trim()
      : '';
  // A new session resets on reopen/identity change, not on query refreshes.
  return (
    <ComposeSession
      key={`${isLoaded ? (user?.id ?? 'signed-out') : 'loading'}:${props.message?.id ?? 'new'}`}
      {...props}
      senderName={senderName}
      senderLoaded={isLoaded}
    />
  );
}

function ComposeSession({
  open,
  onOpenChange,
  message,
  onSaved,
  senderName,
  senderLoaded,
}: ComposeDialogProps & { senderName: string; senderLoaded: boolean }) {
  const { toast } = useToast();
  const invalidate = useInvalidateAll();
  const { settings, deliveryIssue, recheckSettings } = useComposerDelivery();
  const create = useCreateMessage();
  const update = useUpdateMessage();
  const send = useSendMessage();
  const [form, setForm] = useState<MessageInput>(() =>
    initialComposerForm(message, settings),
  );
  const [draftId, setDraftId] = useState<string | null>(message?.id ?? null);
  const [recipients, setRecipients] = useState(() =>
    initialRecipients(message),
  );
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [files, setFiles] = useState<Attachment[]>(() =>
    composerAttachments(message),
  );
  const [uploading, setUploading] = useState(false);
  const [removedFiles, setRemovedFiles] = useState<string[]>([]);
  const changeFiles = (next: Attachment[]) => {
    setRemovedFiles((ids) => [
      ...new Set([
        ...ids,
        ...files
          .filter((f) => !next.some((n) => n.id === f.id))
          .map((f) => f.id),
      ]),
    ]);
    setFiles(next);
    set(
      'attachmentIds',
      next.map((f) => f.id),
    );
    setConfirm(false);
  };

  const set = <K extends keyof MessageInput>(k: K, v: MessageInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const setRecipient = (value: string) =>
    setForm((f) => ({
      ...f,
      recipientEmail: value,
      recipientName:
        value.trim().toLowerCase() === f.recipientEmail.trim().toLowerCase()
          ? f.recipientName
          : '',
    }));
  const changeRecipients = (value: RecipientText) => {
    setRecipients(value);
    setRecipient(recipientInput(value).recipientEmail);
    setConfirm(false);
  };
  const valid =
    !recipientError(recipients) &&
    form.subject.trim() &&
    form.body.trim() &&
    !messageTooLong(form);
  const mutating = [create, update, send].some((m) => m.isPending);
  const busy = mutating || uploading;

  async function save(): Promise<Message | null> {
    setErr(null);
    const data = {
      ...form,
      ...recipientInput(recipients),
      recipientName: form.recipientName.trim(),
    };
    try {
      const m = draftId
        ? await update.mutateAsync({ id: draftId, data })
        : await create.mutateAsync({ data });
      setDraftId(m.id);
      for (const id of removedFiles) {
        if (!(await releaseUnusedAttachment(id)))
          toast({
            title: 'Draft saved; unused file cleanup could not finish',
            description:
              'The file remains private. It is not attached to this draft.',
          });
      }
      setRemovedFiles([]);
      invalidate();
      onSaved?.(m);
      return m;
    } catch (e) {
      setErr(errorText(e));
      return null;
    }
  }

  async function saveOnly() {
    const m = await save();
    if (m) {
      toast({ title: 'Draft saved', description: m.subject });
      onOpenChange(false);
    }
  }

  async function saveThenConfirm() {
    if (deliveryIssue) return;
    const m = await save();
    if (m) setConfirm(true);
  }

  async function doSend() {
    if (!draftId || deliveryIssue) return;
    try {
      const m = await send.mutateAsync({ id: draftId });
      invalidate();
      setConfirm(false);
      onOpenChange(false);
      onSaved?.(m);
      toast({
        title:
          m.status === 'sent' ? 'Sent through Gmail' : `Status: ${m.status}`,
        description: `${m.recipientEmail} · ${m.subject}`,
      });
    } catch (e) {
      setConfirm(false);
      setErr(errorText(e));
      invalidate();
    }
  }

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(value) => {
          if (!mutating) onOpenChange(value);
        }}
      >
        <DialogContent className="max-h-[90dvh] max-w-2xl gap-0 overflow-y-auto rounded-md border-border bg-card p-0">
          <DialogHeader className="border-b border-border bg-background/60 px-5 py-4 text-left">
            <DialogTitle className="font-display text-xl font-bold">
              {draftId ? 'Edit draft' : 'New tracked email'}
            </DialogTitle>
            <DialogDescription className="text-xs">
              Send one shared message to multiple To, Cc and Bcc recipients.
              Separate addresses with commas or semicolons. Shared pixel loads
              and clicks cannot identify which recipient engaged.
            </DialogDescription>
          </DialogHeader>
          <ComposerDeliveryNotice
            issue={deliveryIssue}
            recheck={() => {
              void recheckSettings();
            }}
          />
          <div className="divide-y divide-border">
            <ComposerRecipients
              value={recipients}
              onChange={changeRecipients}
            />
            <Row label="Sender">
              <Input
                data-testid="input-sender-name"
                aria-label="Sender name"
                value={senderName}
                readOnly
                placeholder={
                  senderLoaded
                    ? 'No sender name in your account profile'
                    : 'Loading your account name…'
                }
                className="border-0 bg-transparent shadow-none focus-visible:ring-0"
              />
            </Row>
            <Row label="Subject">
              <Input
                data-testid="input-subject"
                value={form.subject}
                onChange={(e) => set('subject', e.target.value)}
                placeholder="Subject"
                className="border-0 bg-transparent font-medium shadow-none focus-visible:ring-0"
                maxLength={200}
              />
            </Row>
            <ComposerBody
              form={form}
              onChange={(html, text) => {
                setForm((f) => ({ ...f, body: text, bodyHtml: html }));
                setConfirm(false);
              }}
              disabled={mutating}
            />
          </div>
          <EmailAttachments
            files={files}
            onChange={changeFiles}
            onBusy={setUploading}
            onError={setErr}
            disabled={mutating}
          />
          <div className="flex flex-wrap items-center gap-5 border-t border-border bg-background/60 px-5 py-3 text-xs">
            <label className="flex items-center gap-2">
              <Switch
                data-testid="switch-track-opens"
                checked={form.trackOpens}
                onCheckedChange={(v) => set('trackOpens', v)}
              />{' '}
              Track pixel loads
            </label>
            <label className="flex items-center gap-2">
              <Switch
                data-testid="switch-track-clicks"
                checked={form.trackClicks}
                onCheckedChange={(v) => set('trackClicks', v)}
              />{' '}
              Link tracking
            </label>
            <span className="ml-auto font-mono text-[10px] text-muted-foreground">
              {form.body.length.toLocaleString()} chars
            </span>
          </div>
          {err && (
            <div
              className="border-t border-destructive/30 bg-destructive/5 px-5 py-3 text-sm text-destructive"
              data-testid="text-compose-error"
            >
              {err}
            </div>
          )}
          <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-4 sm:flex-row sm:justify-end">
            <button
              data-testid="button-save-draft"
              disabled={!valid || busy}
              onClick={saveOnly}
              className="inline-flex items-center justify-center gap-2 rounded-sm border border-border px-4 py-2 text-sm font-medium hover:border-foreground/40 disabled:opacity-40"
            >
              {create.isPending || update.isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Save className="size-4" />
              )}{' '}
              Save draft
            </button>
            <button
              data-testid="button-review-send"
              disabled={!valid || busy || !!deliveryIssue}
              onClick={saveThenConfirm}
              className="inline-flex items-center justify-center gap-2 rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-transform hover:bg-primary/90 active:scale-[0.98] disabled:opacity-40"
            >
              <Send className="size-4" /> Save & review send
            </button>
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirm} onOpenChange={setConfirm}>
        <AlertDialogContent className="rounded-md bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display text-xl">
              Send via your Gmail?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-3 text-sm">
                <ComposerDeliveryWarning issue={deliveryIssue} />
                <div className="grid grid-cols-[70px_1fr] gap-y-1.5 border border-border bg-background p-3 font-mono text-xs text-foreground">
                  <RecipientReview value={recipients} />
                  <span className="text-muted-foreground">SUBJECT</span>
                  <span data-testid="text-confirm-subject">{form.subject}</span>
                  <span className="text-muted-foreground">FILES</span>
                  <span>
                    {files.length
                      ? files.map((file) => file.name).join(', ')
                      : 'None'}
                  </span>
                  <span className="text-muted-foreground">GLYPH</span>
                  <span>
                    {form.trackOpens ? 'pixel tracking' : 'no pixel'} ·{' '}
                    {form.trackClicks ? 'links tracked' : 'links untouched'}
                  </span>
                </div>
                <Caveat>
                  This really sends. Signals that follow are hints, not read
                  receipts.
                </Caveat>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-send">
              Not yet
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-send"
              onClick={(e) => {
                e.preventDefault();
                doSend();
              }}
              disabled={send.isPending || !!deliveryIssue}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              {send.isPending ? (
                <Loader2 className="mr-2 size-4 animate-spin" />
              ) : (
                <Send className="mr-2 size-4" />
              )}{' '}
              Send now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center px-3">
      <span className="w-16 shrink-0 pl-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      {children}
    </div>
  );
}
