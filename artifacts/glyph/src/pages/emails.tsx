import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { Search, PenLine, Send, Trash2, Pencil, Link2 } from 'lucide-react';
import { MessageSummary, SignalTrail } from '@/components/message-summary';
import { MessageEngagement } from '@/components/engagement';
import {
  useListMessages,
  useGetMessage,
  useDeleteMessage,
  useSendMessage,
  getListMessagesQueryKey,
  getGetMessageQueryKey,
  type Message,
} from '@workspace/api-client-react';
import { Skeleton } from '@/components/ui/skeleton';
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
import {
  Avatar,
  Caveat,
  ReadOnlyTag,
  EmptyState,
  ErrorState,
  SectionHead,
  SignInNudge,
  StatusPill,
} from '@/components/bits';
import { ComposeDialog } from '@/components/compose-dialog';
import { GMAIL_URL, SyncGmailButton } from '@/components/gmail-sync';
import {
  ago,
  errorText,
  usePoll,
  useInvalidateAll,
  useSession,
} from '@/lib/glyph';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const STATUSES = [
  'all',
  'draft',
  'sent',
  'sending',
  'uncertain',
  'failed',
] as const;

function messageFilters(search: string, status: (typeof STATUSES)[number]) {
  return {
    ...(search ? { search } : {}),
    ...(status !== 'all' ? { status } : {}),
  };
}

export default function Emails() {
  const params = useParams<{ id?: string }>();
  const selected = params.id;
  const { isSignedIn } = useSession();
  const poll = usePoll();
  const [q, setQ] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState<(typeof STATUSES)[number]>('all');
  const [compose, setCompose] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const p = messageFilters(debounced, status);
  const list = useListMessages(p, {
    query: { refetchInterval: poll, queryKey: getListMessagesQueryKey(p) },
  });
  const readOnly = !isSignedIn;

  return (
    <div className="space-y-6">
      <SectionHead
        kicker="Tracked messages"
        title={
          <span className="flex items-center gap-3">
            Emails {readOnly && <ReadOnlyTag />}
          </span>
        }
        right={
          isSignedIn ? (
            <div className="flex flex-wrap gap-2">
              <SyncGmailButton className="py-2.5" />
              <button
                data-testid="button-compose"
                onClick={() => setCompose(true)}
                className="inline-flex items-center gap-2 rounded-sm bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 active:scale-[0.98]"
              >
                <PenLine className="size-4" /> Web composer
              </button>
            </div>
          ) : null
        }
      />
      {!isSignedIn && <SignInNudge what="compose and send" />}

      <div className="grid gap-0 border border-border bg-card lg:grid-cols-[minmax(0,420px)_1fr]">
        <div
          className={cn(
            'border-border lg:border-r',
            selected && 'hidden lg:block',
          )}
        >
          <div className="space-y-3 border-b border-border p-3">
            <label className="flex items-center gap-2 rounded-sm border border-input bg-background px-3 focus-within:border-primary">
              <Search className="size-4 text-muted-foreground" />
              <input
                data-testid="input-search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search recipient or subject"
                className="h-9 w-full bg-transparent text-sm outline-none"
              />
            </label>
            <div className="flex flex-wrap gap-1">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  data-testid={`filter-${s}`}
                  onClick={() => setStatus(s)}
                  className={cn(
                    'rounded-sm px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors',
                    status === s
                      ? 'bg-foreground text-background'
                      : 'text-muted-foreground hover:bg-muted',
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          {list.isLoading ? (
            <div className="space-y-2 p-3">
              {[0, 1, 2, 3, 4].map((i) => (
                <Skeleton key={i} className="h-14" />
              ))}
            </div>
          ) : list.isError ? (
            <div className="p-3">
              <ErrorState
                error={errorText(list.error)}
                onRetry={() => list.refetch()}
              />
            </div>
          ) : !list.data?.length ? (
            <EmptyState
              title={
                debounced || status !== 'all'
                  ? 'No matches'
                  : 'No tracked emails'
              }
              body={
                debounced || status !== 'all'
                  ? 'Try a different search or filter.'
                  : 'Messages you glyph inside Gmail appear here. The web composer above is a secondary option.'
              }
              action={
                isSignedIn && !debounced && status === 'all' ? (
                  <button
                    onClick={() => setCompose(true)}
                    data-testid="button-compose-empty"
                    className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                  >
                    Compose
                  </button>
                ) : undefined
              }
            />
          ) : (
            <ul className="max-h-[70dvh] divide-y divide-border overflow-y-auto">
              {list.data.map((m) => (
                <li key={m.id}>
                  <Link
                    href={`/emails/${m.id}`}
                    data-testid={`row-email-${m.id}`}
                    className={cn(
                      'flex gap-3 px-3 py-3 transition-colors hover:bg-muted/50',
                      selected === m.id &&
                        'bg-muted shadow-[inset_2px_0_0_hsl(var(--primary))]',
                    )}
                  >
                    <Avatar name={m.recipientName} email={m.recipientEmail} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium">
                          {m.recipientName || m.recipientEmail}
                        </span>
                        {m.deliverySource === 'gmail' && (
                          <span className="rounded-sm bg-secondary px-1 font-mono text-[9px] uppercase text-muted-foreground">
                            gmail
                          </span>
                        )}
                        <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                          {ago(m.sentAt ?? m.createdAt)}
                        </span>
                      </div>
                      <div className="truncate text-xs text-foreground/80">
                        {m.subject}
                      </div>
                      <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
                        {(m.deliverySource !== 'gmail' ||
                          m.status === 'sent') &&
                          m.status !== 'sent' && (
                            <StatusPill status={m.status} />
                          )}
                        {m.status !== 'draft' ||
                        m.deliverySource === 'gmail' ? (
                          <MessageEngagement m={m} compact />
                        ) : null}
                      </div>
                    </div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={cn(!selected && 'hidden lg:block')}>
          {selected ? (
            <Detail key={selected} id={selected} />
          ) : (
            <div className="flex h-full min-h-[380px] items-center justify-center p-8 text-center text-sm text-muted-foreground dotgrid">
              Pick a message to see its signal trail.
            </div>
          )}
        </div>
      </div>
      <ComposeDialog open={compose} onOpenChange={setCompose} />
    </div>
  );
}

function Detail({ id }: { id: string }) {
  const poll = usePoll();
  const [, setLocation] = useLocation();
  const { isSignedIn } = useSession();
  const { toast } = useToast();
  const invalidate = useInvalidateAll();
  const q = useGetMessage(id, {
    query: { refetchInterval: poll, queryKey: getGetMessageQueryKey(id) },
  });
  const del = useDeleteMessage();
  const send = useSendMessage();
  const [edit, setEdit] = useState(false);
  const [confirmDel, setConfirmDel] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);

  if (q.isLoading)
    return (
      <div className="space-y-3 p-6">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-40" />
      </div>
    );
  if (q.isError || !q.data)
    return (
      <div className="p-6">
        <ErrorState error={errorText(q.error)} onRetry={() => q.refetch()} />
      </div>
    );
  const { message: m, events, links } = q.data;
  const canMutate = isSignedIn;
  const native = m.deliverySource === 'gmail';
  const awaiting = native && m.status !== 'sent';

  const doDelete = () =>
    del.mutate(
      { id },
      {
        onSuccess: () => {
          invalidate();
          toast({ title: 'Draft deleted' });
          setLocation('/emails');
        },
        onError: (e) =>
          toast({
            title: 'Delete failed',
            description: errorText(e),
            variant: 'destructive',
          }),
        onSettled: () => setConfirmDel(false),
      },
    );
  const doSend = () =>
    native
      ? undefined
      : send.mutate(
          { id },
          {
            onSuccess: (r: Message) => {
              invalidate();
              toast({
                title:
                  r.status === 'sent'
                    ? 'Sent through Gmail'
                    : `Status: ${r.status}`,
                description: `${r.recipientEmail} · ${r.subject}`,
              });
            },
            onError: (e) => {
              invalidate();
              toast({
                title: 'Send failed',
                description: errorText(e),
                variant: 'destructive',
              });
            },
            onSettled: () => setConfirmSend(false),
          },
        );

  return (
    <div className="rise">
      <div className="border-b border-border p-5 md:p-6">
        <MessageSummary m={m} awaiting={awaiting} />
        {awaiting && (
          <div className="mt-4 space-y-3">
            <Caveat>
              Drafted in Gmail with Add glyph. It counts as sent only after
              Glyph finds its marker in your Gmail Sent folder. Send it from
              Gmail, then sync.
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
        {!native && ['draft', 'failed'].includes(m.status) && (
          <div className="mt-4 flex flex-wrap gap-2">
            <button
              data-testid="button-edit-draft"
              disabled={!canMutate}
              onClick={() => setEdit(true)}
              className="inline-flex items-center gap-1.5 rounded-sm border border-border px-3 py-1.5 text-sm hover:border-foreground/40 disabled:opacity-40"
            >
              <Pencil className="size-3.5" /> Edit
            </button>
            <button
              data-testid="button-send-draft"
              disabled={!canMutate || m.status === 'failed'}
              onClick={() => setConfirmSend(true)}
              className="inline-flex items-center gap-1.5 rounded-sm bg-primary px-3 py-1.5 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
            >
              <Send className="size-3.5" /> Send
            </button>
            <button
              data-testid="button-delete-draft"
              disabled={!canMutate}
              onClick={() => setConfirmDel(true)}
              className="ml-auto inline-flex items-center gap-1.5 rounded-sm px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-40"
            >
              <Trash2 className="size-3.5" /> Delete
            </button>
          </div>
        )}
        {!native && !canMutate && m.status === 'draft' && (
          <p className="mt-2 text-xs text-muted-foreground">
            Sample drafts are read-only. Sign in with the Gmail owner account to
            edit or send.
          </p>
        )}
        {!native && m.status === 'failed' && (
          <p className="mt-2 text-xs text-destructive">
            Gmail rejected the send. Edit and save this draft before trying
            again.
          </p>
        )}
        {!native && ['uncertain', 'sending'].includes(m.status) && (
          <div className="mt-4 space-y-3">
            <Caveat>
              Gmail has not confirmed this send. Check your Sent folder before
              creating another email to avoid a duplicate.
            </Caveat>
            <button
              type="button"
              disabled={!canMutate || send.isPending}
              onClick={doSend}
              className="rounded-sm border border-border px-3 py-1.5 text-sm disabled:opacity-40"
            >
              Check Gmail send status
            </button>
          </div>
        )}
      </div>

      <div className="grid xl:grid-cols-[1fr_300px]">
        <div className="border-b border-border p-5 md:p-6 xl:border-b-0 xl:border-r">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Body
          </div>
          <pre
            className="whitespace-pre-wrap break-words font-sans text-sm leading-relaxed"
            data-testid="text-body"
          >
            {m.body}
          </pre>
          {links.length > 0 && (
            <div className="mt-6">
              <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
                Tracked links
              </div>
              <ul className="divide-y divide-border border border-border">
                {links.map((l) => (
                  <li
                    key={l.id}
                    className="flex items-center gap-2 px-3 py-2 text-xs"
                    data-testid={`row-link-${l.id}`}
                  >
                    <Link2 className="size-3.5 shrink-0 text-muted-foreground" />
                    <span className="truncate font-mono">{l.url}</span>
                    <span className="ml-auto shrink-0 font-mono tabular-nums text-primary">
                      {l.clicks}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
        <SignalTrail events={events} message={m} />
      </div>

      <ComposeDialog open={edit} onOpenChange={setEdit} message={m} />
      <AlertDialog open={confirmDel} onOpenChange={setConfirmDel}>
        <AlertDialogContent className="rounded-md bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">
              Delete this draft?
            </AlertDialogTitle>
            <AlertDialogDescription>
              "{m.subject}" to {m.recipientEmail}. This can't be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">
              Keep
            </AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-delete"
              onClick={(e) => {
                e.preventDefault();
                doDelete();
              }}
              disabled={del.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete draft
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
      <AlertDialog open={confirmSend} onOpenChange={setConfirmSend}>
        <AlertDialogContent className="rounded-md bg-card">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">
              Send via your Gmail?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="grid grid-cols-[70px_1fr] gap-y-1.5 border border-border bg-background p-3 font-mono text-xs text-foreground">
                <span className="text-muted-foreground">TO</span>
                <span
                  className="break-all"
                  data-testid="text-confirm-recipient"
                >
                  {m.recipientEmail}
                </span>
                <span className="text-muted-foreground">SUBJECT</span>
                <span data-testid="text-confirm-subject">{m.subject}</span>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Not yet</AlertDialogCancel>
            <AlertDialogAction
              data-testid="button-confirm-send"
              onClick={(e) => {
                e.preventDefault();
                doSend();
              }}
              disabled={send.isPending}
              className="bg-primary text-primary-foreground hover:bg-primary/90"
            >
              Send now
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
