import { useState } from 'react';
import { Send, Save, Loader2 } from 'lucide-react';
import {
  useCreateMessage,
  useUpdateMessage,
  useSendMessage,
  useGetSettings,
  type Message,
  type MessageInput,
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
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/hooks/use-toast';
import { errorText, useInvalidateAll } from '@/lib/glyph';
import { Caveat } from '@/components/bits';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type ComposeDialogProps = {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  message?: Message | null;
  onSaved?: (m: Message) => void;
};

export function ComposeDialog(props: ComposeDialogProps) {
  if (!props.open) return null;
  // A new session resets on reopen/identity change, not on query refreshes.
  return <ComposeSession key={props.message?.id ?? 'new'} {...props} />;
}

function ComposeSession({
  open,
  onOpenChange,
  message,
  onSaved,
}: ComposeDialogProps) {
  const { toast } = useToast();
  const invalidate = useInvalidateAll();
  const { data: settings } = useGetSettings();
  const create = useCreateMessage();
  const update = useUpdateMessage();
  const send = useSendMessage();
  const [form, setForm] = useState<MessageInput>(() => ({
    recipientEmail: message?.recipientEmail ?? '',
    recipientName: message?.recipientName ?? '',
    subject: message?.subject ?? '',
    body: message?.body ?? '',
    trackOpens: message?.trackOpens ?? settings?.defaultTrackOpens ?? true,
    trackClicks: message?.trackClicks ?? settings?.defaultTrackClicks ?? true,
  }));
  const [draftId, setDraftId] = useState<string | null>(message?.id ?? null);
  const [confirm, setConfirm] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = <K extends keyof MessageInput>(k: K, v: MessageInput[K]) =>
    setForm((f) => ({ ...f, [k]: v }));
  const valid =
    EMAIL.test(form.recipientEmail.trim()) &&
    form.subject.trim() &&
    form.body.trim();
  const busy = create.isPending || update.isPending || send.isPending;

  async function save(): Promise<Message | null> {
    setErr(null);
    const data = {
      ...form,
      recipientEmail: form.recipientEmail.trim(),
      recipientName: form.recipientName.trim(),
    };
    try {
      const m = draftId
        ? await update.mutateAsync({ id: draftId, data })
        : await create.mutateAsync({ data });
      setDraftId(m.id);
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
    const m = await save();
    if (m) setConfirm(true);
  }

  async function doSend() {
    if (!draftId) return;
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
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-2xl gap-0 overflow-hidden rounded-md border-border bg-card p-0">
          <DialogHeader className="border-b border-border bg-background/60 px-5 py-4 text-left">
            <DialogTitle className="font-display text-xl font-bold">
              {draftId ? 'Edit draft' : 'New tracked email'}
            </DialogTitle>
            <DialogDescription className="text-xs">
              One recipient per message, so every signal maps to one person.
              Plain text; links are tracked automatically.
            </DialogDescription>
          </DialogHeader>
          <div className="divide-y divide-border">
            <Row label="To">
              <Input
                data-testid="input-recipient-email"
                type="email"
                value={form.recipientEmail}
                onChange={(e) => set('recipientEmail', e.target.value)}
                placeholder="maya@harborline.co"
                className="border-0 bg-transparent shadow-none focus-visible:ring-0"
                maxLength={254}
              />
            </Row>
            <Row label="Name">
              <Input
                data-testid="input-recipient-name"
                value={form.recipientName}
                onChange={(e) => set('recipientName', e.target.value)}
                placeholder="Maya Okafor (optional)"
                className="border-0 bg-transparent shadow-none focus-visible:ring-0"
                maxLength={120}
              />
            </Row>
            <Row label="Subject">
              <Input
                data-testid="input-subject"
                value={form.subject}
                onChange={(e) => set('subject', e.target.value)}
                placeholder="Quick question about Q3 freight volumes"
                className="border-0 bg-transparent font-medium shadow-none focus-visible:ring-0"
                maxLength={200}
              />
            </Row>
            <Textarea
              data-testid="input-body"
              value={form.body}
              onChange={(e) => set('body', e.target.value)}
              placeholder={'Hi Maya,\n\nSaw the Rotterdam expansion news...'}
              className="min-h-[220px] resize-y rounded-none border-0 bg-transparent px-5 py-4 font-[inherit] text-sm leading-relaxed shadow-none focus-visible:ring-0"
              maxLength={50000}
            />
          </div>
          <div className="flex flex-wrap items-center gap-5 border-t border-border bg-background/60 px-5 py-3 text-xs">
            <label className="flex items-center gap-2">
              <Switch
                data-testid="switch-track-opens"
                checked={form.trackOpens}
                onCheckedChange={(v) => set('trackOpens', v)}
              />{' '}
              Open pixel
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
              disabled={!valid || busy}
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
                <div className="grid grid-cols-[70px_1fr] gap-y-1.5 border border-border bg-background p-3 font-mono text-xs text-foreground">
                  <span className="text-muted-foreground">TO</span>
                  <span
                    data-testid="text-confirm-recipient"
                    className="break-all"
                  >
                    {form.recipientName
                      ? `${form.recipientName} <${form.recipientEmail}>`
                      : form.recipientEmail}
                  </span>
                  <span className="text-muted-foreground">SUBJECT</span>
                  <span data-testid="text-confirm-subject">{form.subject}</span>
                  <span className="text-muted-foreground">GLYPH</span>
                  <span>
                    {form.trackOpens ? 'open pixel' : 'no pixel'} ·{' '}
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
              disabled={send.isPending}
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
