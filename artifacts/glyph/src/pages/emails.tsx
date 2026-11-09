import { useEffect, useState } from 'react';
import { useLocation, useParams } from 'wouter';
import { Link2, PenLine } from 'lucide-react';
import { MessageSummary } from '@/components/message-summary';
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
  ReadOnlyTag,
  ErrorState,
  SectionHead,
  SignInNudge,
} from '@/components/bits';
import { ComposeDialog } from '@/components/compose-dialog';
import { EmailBody } from '@/components/email-body';
import { SyncGmailButton } from '@/components/gmail-sync';
import {
  EmailListPanel,
  type MessageStatus,
} from '@/components/email-list-panel';
import { MessageWorkflowActions } from '@/components/message-workflow-actions';
import { SignalHistory } from '@/components/signal-history';
import { PixelDiagnostics } from '@/components/pixel-diagnostics';
import { errorText, usePoll, useInvalidateAll, useSession } from '@/lib/glyph';
import { HISTORY_PAGE_SIZE } from '@/lib/history-pagination';
import { useToast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

function messageFilters(search: string, status: MessageStatus) {
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
  const [status, setStatus] = useState<MessageStatus>('all');
  const [offset, setOffset] = useState(0);
  const [compose, setCompose] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(q.trim()), 250);
    return () => clearTimeout(t);
  }, [q]);
  const p = {
    ...messageFilters(debounced, status),
    limit: HISTORY_PAGE_SIZE,
    offset,
  };
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
        <EmailListPanel
          list={list}
          search={q}
          onSearchChange={(value) => {
            setQ(value);
            setOffset(0);
          }}
          status={status}
          onStatusChange={(value) => {
            setStatus(value);
            setOffset(0);
          }}
          selected={selected}
          isSignedIn={isSignedIn}
          offset={offset}
          onOffsetChange={setOffset}
          hasActiveFilters={Boolean(debounced) || status !== 'all'}
          onCompose={() => setCompose(true)}
        />
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
  const { message: m, links } = q.data;
  const canMutate = isSignedIn;
  const awaiting = m.deliverySource === 'gmail' && m.status !== 'sent';

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
    send.mutate(
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
        <MessageWorkflowActions
          message={m}
          canMutate={canMutate}
          sendPending={send.isPending}
          onEdit={() => setEdit(true)}
          onDelete={() => setConfirmDel(true)}
          onConfirmSend={() => setConfirmSend(true)}
          onCheckSend={doSend}
        />
      </div>

      <div className="grid xl:grid-cols-[1fr_300px]">
        <div className="border-b border-border p-5 md:p-6 xl:border-b-0 xl:border-r">
          <div className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
            Body
          </div>
          <EmailBody message={m} />
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
        <div>
          <PixelDiagnostics data={q.data.diagnostics} />
          <SignalHistory id={id} message={m} />
        </div>
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
