import { useState } from 'react';
import { Link } from 'wouter';
import { RefreshCw } from 'lucide-react';
import { Caveat, EmptyState, ErrorState, SectionHead } from '@/components/bits';
import { DatabaseApprovalForm } from '@/components/database-approval-form';
import { DatabaseApprovalCard } from '@/components/database-approval-card';
import {
  APPROVAL_PAGE_SIZE,
  useApprovalAccess,
  useApprovalList,
} from '@/lib/database-approvals';

export default function DatabaseApprovalsPage() {
  const access = useApprovalAccess();
  if (access.isPending)
    return (
      <div role="status" className="p-6 text-sm text-muted-foreground">
        Checking approval access…
      </div>
    );
  if (access.isError)
    return (
      <ErrorState
        error="Approval access could not be verified."
        onRetry={() => void access.refetch()}
      />
    );
  if (!access.data?.canApprove)
    return (
      <section
        className="max-w-xl space-y-3 border border-border bg-card p-6"
        data-testid="state-approval-denied"
      >
        <h1 className="font-display text-2xl font-extrabold">
          Database approvals restricted
        </h1>
        <p className="text-sm text-muted-foreground">
          Only the two designated maintainer accounts can record database-change
          approvals.
        </p>
        <Link
          className="text-sm font-semibold text-primary underline"
          href="/app"
        >
          Return to Signals
        </Link>
      </section>
    );
  return <ApprovalWorkspace slot={access.data.slot ?? null} />;
}

function ApprovalWorkspace({ slot }: { slot: 'first' | 'second' | null }) {
  const [offset, setOffset] = useState(0);
  const list = useApprovalList(offset, true);
  return (
    <div className="space-y-6">
      <SectionHead
        kicker="Maintainers"
        title="Database approvals"
        right={
          <button
            type="button"
            onClick={() => void list.refetch()}
            disabled={list.isFetching}
            data-testid="button-refresh-approvals"
            className="inline-flex items-center gap-2 rounded-sm border border-border bg-card px-3 py-2 text-sm font-medium hover:border-foreground/40 disabled:opacity-50"
          >
            <RefreshCw
              className={`size-4 ${list.isFetching ? 'animate-spin' : ''}`}
            />{' '}
            Refresh
          </button>
        }
      />
      <Caveat>
        <strong>Approval recording only.</strong> These buttons never execute
        SQL or change the schema. "Consumed" means the single-use authorization
        was marked spent, not that any operation ran. There is no privileged
        executor, and these records do not restrict owner SQL consoles or
        Publish. You are signed in as the{' '}
        <span className="font-mono" data-testid="text-slot">
          {slot ?? 'unassigned'}
        </span>{' '}
        approver.
      </Caveat>
      <div className="grid items-start gap-6 lg:grid-cols-[360px_1fr]">
        <DatabaseApprovalForm />
        <section className="space-y-3" aria-label="Approval records">
          {list.isPending ? (
            [0, 1].map((i) => (
              <div
                key={i}
                className="h-56 animate-pulse border border-border bg-muted/60"
              />
            ))
          ) : list.isError ? (
            <ErrorState
              error="Approval records could not be loaded."
              onRetry={() => void list.refetch()}
            />
          ) : !list.data.items.length ? (
            <EmptyState
              title="No requests yet"
              body="Recorded requests appear here with their digests, approvals and expiry."
            />
          ) : (
            list.data.items.map((a) => (
              <DatabaseApprovalCard key={a.id} approval={a} slot={slot} />
            ))
          )}
          {!list.isPending &&
            !list.isError &&
            (offset > 0 || list.data.hasMore) && (
              <div className="flex items-center justify-between text-sm">
                <button
                  type="button"
                  disabled={offset === 0}
                  data-testid="button-approvals-prev"
                  onClick={() =>
                    setOffset(Math.max(0, offset - APPROVAL_PAGE_SIZE))
                  }
                  className="rounded-sm border border-border px-3 py-1.5 disabled:opacity-40"
                >
                  Newer
                </button>
                <span className="font-mono text-xs text-muted-foreground">
                  {offset + 1}-{offset + list.data.items.length}
                </span>
                <button
                  type="button"
                  disabled={!list.data.hasMore}
                  data-testid="button-approvals-next"
                  onClick={() => setOffset(offset + APPROVAL_PAGE_SIZE)}
                  className="rounded-sm border border-border px-3 py-1.5 disabled:opacity-40"
                >
                  Older
                </button>
              </div>
            )}
        </section>
      </div>
    </div>
  );
}
