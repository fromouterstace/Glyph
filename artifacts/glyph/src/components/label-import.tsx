import { useEffect, useRef } from 'react';
import { useAuth } from '@clerk/react';
import { Link } from 'wouter';
import { RotateCw, Tag } from 'lucide-react';
import {
  useIsMutating,
  useMutationState,
  useQueryClient,
} from '@tanstack/react-query';
import {
  getGetLabelImportQueryKey,
  getListContactsQueryKey,
  getSyncLabelImportMutationKey,
  useGetGmailAuthorization,
  useGetLabelImport,
  useSyncLabelImport,
  type LabelImportStatus,
  type Message,
} from '@workspace/api-client-react';
import { ago, errorText, useSession } from '@/lib/glyph';
import { cn } from '@/lib/utils';

export const AUTO_IMPORT_MS = 60_000;

export function isImported(m: Pick<Message, 'deliverySource'>) {
  return m.deliverySource === 'import';
}

/** Imported rows use status "sent" only as a storage lifecycle. */
export function ImportedTag({ compact = false }: { compact?: boolean }) {
  return (
    <span
      data-testid="tag-imported"
      title="Imported from your Gmail label. Glyph has no historical send or open tracking for this message."
      className="inline-flex items-center gap-1.5 rounded-sm border border-[hsl(var(--chart-2)/0.35)] bg-accent/60 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-accent-foreground"
    >
      <Tag className="size-3" />
      Imported
      {!compact && (
        <span className="normal-case tracking-normal opacity-70">
          / No historical tracking
        </span>
      )}
    </span>
  );
}

function useRefreshAfterImport() {
  const qc = useQueryClient();
  return (status: LabelImportStatus) => {
    qc.setQueryData(getGetLabelImportQueryKey(), status);
    // Refresh lists and details; editors guard their own init so open edits are kept.
    qc.invalidateQueries({
      predicate: (q) =>
        String(q.queryKey[0] ?? '').startsWith('/api/glyph/messages'),
    });
    qc.invalidateQueries({ queryKey: getListContactsQueryKey() });
  };
}

function errStatus(err: unknown) {
  return (err as { status?: number } | null)?.status;
}

export function importProblem(
  status: LabelImportStatus | undefined,
  err: unknown,
  connected?: boolean,
): { kind: 'connection' | 'label' | 'error'; text: string } | null {
  const code = errStatus(err);
  if (code === 401)
    return {
      kind: 'error',
      text: 'Your Glyph session could not be verified. Sign in again, then retry the import.',
    };
  if (connected === false)
    return {
      kind: 'connection',
      text: 'Connect your Gmail account to import labeled messages and contacts.',
    };
  if (code === 403)
    return {
      kind: 'error',
      text: 'Gmail import was denied. Review your mailbox permissions on the Gmail page, then retry.',
    };
  if (status?.status === 'label_missing')
    return {
      kind: 'label',
      text: 'No Gmail label named "Glyph" was found. Create a label named Glyph, add messages to it, then retry. Previously imported messages and contacts are kept.',
    };
  if (err) return { kind: 'error', text: errorText(err) };
  if (status?.status === 'error')
    return {
      kind: 'error',
      text: 'The last import did not finish. Retry when ready.',
    };
  return null;
}

/** One shared controller, mounted in Shell. Imports on open and every 60s, never overlapping. */
export function LabelImportController() {
  const { isSignedIn } = useSession();
  const { userId } = useAuth();
  const qc = useQueryClient();
  const refresh = useRefreshAfterImport();
  const { mutateAsync } = useSyncLabelImport();
  const refreshRef = useRef(refresh);
  const mutateRef = useRef(mutateAsync);
  useEffect(() => {
    refreshRef.current = refresh;
    mutateRef.current = mutateAsync;
  });
  useGetLabelImport({
    query: { enabled: isSignedIn, queryKey: getGetLabelImportQueryKey() },
  });

  useEffect(() => {
    if (!isSignedIn) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const run = async () => {
      const busy =
        qc.isMutating({ mutationKey: getSyncLabelImportMutationKey() }) > 0;
      if (!busy) {
        try {
          const s = await mutateRef.current();
          if (!cancelled) refreshRef.current(s);
        } catch {
          // Shown inline by LabelImportPanel; the next tick retries, so a Gmail reconnect resumes automatically.
        }
      }
      if (!cancelled) timer = setTimeout(run, AUTO_IMPORT_MS);
    };
    void run();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isSignedIn, userId, qc]);

  return null;
}

type Problem = ReturnType<typeof importProblem>;

function dotClass(problem: Problem, syncing: boolean, s?: LabelImportStatus) {
  if (problem) return 'bg-primary';
  if (syncing || s?.status === 'synced') return 'bg-[hsl(var(--chart-2))]';
  return 'bg-muted-foreground/50';
}

function StatusText({
  loading,
  problem,
  syncing,
  s,
}: {
  loading: boolean;
  problem: Problem;
  syncing: boolean;
  s?: LabelImportStatus;
}) {
  if (loading)
    return (
      <span className="inline-block h-4 w-40 animate-pulse rounded-sm bg-muted" />
    );
  if (problem) return <span>{problem.text}</span>;
  if (syncing) return <>Importing labeled messages and contacts...</>;
  if (s?.status === 'synced')
    return (
      <>
        Synced {ago(s.lastSyncedAt)}. Checks again every minute while Glyph is
        open.
      </>
    );
  return <>Waiting for the first import.</>;
}

function useLastSyncError() {
  const last = useMutationState({
    filters: { mutationKey: getSyncLabelImportMutationKey() },
    select: (m) => ({ status: m.state.status, error: m.state.error }),
  }).at(-1);
  return last?.status === 'error' ? last.error : null;
}

export function LabelImportPanel() {
  const authorization = useGetGmailAuthorization({
    query: { refetchOnMount: 'always', refetchInterval: AUTO_IMPORT_MS },
  });
  const status = useGetLabelImport({
    query: { queryKey: getGetLabelImportQueryKey() },
  });
  const refresh = useRefreshAfterImport();
  const sync = useSyncLabelImport();
  const running =
    useIsMutating({ mutationKey: getSyncLabelImportMutationKey() }) > 0;
  const lastError = useLastSyncError();
  const s = status.data;
  const problem = importProblem(
    s,
    lastError ?? status.error,
    authorization.isError || authorization.isFetching
      ? undefined
      : authorization.data?.connected,
  );
  const syncing = running || s?.status === 'syncing';

  const retry = () => {
    if (!running) sync.mutate(undefined, { onSuccess: refresh });
  };

  return (
    <div
      data-testid="panel-label-import"
      className={cn(
        'flex flex-wrap items-center gap-x-4 gap-y-2 border bg-card px-4 py-3',
        problem ? 'border-dashed border-primary/50' : 'border-border',
      )}
    >
      <span className="relative flex size-2.5">
        {syncing && (
          <span className="pulse-ring absolute inset-0 rounded-[2px] bg-[hsl(var(--chart-2))]" />
        )}
        <span
          className={cn(
            'relative size-2.5 rounded-[2px]',
            dotClass(problem, syncing, s),
          )}
        />
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          Gmail label import
        </div>
        <div className="text-sm" data-testid="text-import-status">
          <StatusText
            loading={status.isLoading && !s}
            problem={problem}
            syncing={syncing}
            s={s}
          />
        </div>
      </div>
      {problem?.kind === 'connection' && (
        <Link
          href="/gmail"
          data-testid="link-import-connect"
          className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:bg-primary/90"
        >
          Connect Gmail
        </Link>
      )}
      <button
        type="button"
        data-testid="button-import-retry"
        onClick={retry}
        disabled={running}
        className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-background px-3 py-1.5 text-xs font-medium hover:border-foreground/40 disabled:opacity-50"
      >
        <RotateCw className={cn('size-3.5', running && 'animate-spin')} />
        {running ? 'Importing' : problem ? 'Retry import' : 'Import now'}
      </button>
    </div>
  );
}
