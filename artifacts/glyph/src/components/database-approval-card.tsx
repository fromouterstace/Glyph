import { useState, type ReactNode } from 'react';
import type { DatabaseApproval } from '@workspace/api-client-react';
import { cn } from '@/lib/utils';
import { errorText, stamp } from '@/lib/glyph';
import {
  effectiveStatus,
  operationLabel,
  useApprovalAction,
} from '@/lib/database-approvals';

type Action = 'approve' | 'revoke' | 'consume';
type Slot = 'first' | 'second' | null;
const tone: Record<string, string> = {
  pending: 'border-[hsl(40_70%_52%)] text-[hsl(32_70%_34%)]',
  approved: 'border-[hsl(176_45%_32%)] text-[hsl(176_45%_26%)]',
  consumed: 'border-foreground/50 text-foreground',
  revoked: 'border-destructive text-destructive',
  expired: 'border-muted-foreground text-muted-foreground',
};
const btn =
  'rounded-sm border px-3 py-1.5 text-xs font-semibold disabled:opacity-40';
const confirmCopy: Record<'revoke' | 'consume', string> = {
  consume:
    'Consuming uses this single-use authorization. It records that the approval was spent; it does not run any SQL or schema change.',
  revoke:
    'Revoking permanently cancels this request. It cannot be approved or consumed afterward.',
};

function slotApproval(a: DatabaseApproval, slot: Slot) {
  if (slot === 'first') return a.firstApprovedAt;
  if (slot === 'second') return a.secondApprovedAt;
  return null;
}

function permissions(a: DatabaseApproval, slot: Slot) {
  const status = effectiveStatus(a);
  const live = status === 'pending' || status === 'approved';
  const approvedByMe = !!slotApproval(a, slot);
  return {
    status,
    live,
    approvedByMe,
    approve: status === 'pending' && slot !== null && !approvedByMe,
    revoke: live,
    consume:
      status === 'approved' && !!a.firstApprovedAt && !!a.secondApprovedAt,
  };
}

function Row({
  label,
  children,
  id,
}: {
  label: string;
  children: ReactNode;
  id: string;
}) {
  return (
    <div className="grid gap-1 py-1.5 sm:grid-cols-[140px_1fr]">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-all font-mono text-xs" data-testid={id}>
        {children}
      </dd>
    </div>
  );
}

function ApprovalDetails({ a }: { a: DatabaseApproval }) {
  return (
    <dl className="mt-3 divide-y divide-border">
      <Row label="Environment" id={`text-env-${a.id}`}>
        {a.environment}
      </Row>
      <Row label="Plan SHA-256" id={`text-plan-${a.id}`}>
        {a.planSha256}
      </Row>
      <Row label="Record digest" id={`text-digest-${a.id}`}>
        {a.digest}
      </Row>
      <Row label="Reason" id={`text-reason-${a.id}`}>
        <span className="whitespace-pre-wrap font-sans text-sm">
          {a.reason}
        </span>
      </Row>
      <Row label="Requested by" id={`text-requester-${a.id}`}>
        {a.requestedBy} at {stamp(a.createdAt)}
      </Row>
      <Row label="Expires" id={`text-expiry-${a.id}`}>
        {stamp(a.expiresAt)}
      </Row>
      <Row label="First approver" id={`text-first-${a.id}`}>
        {a.firstApprovedAt ? stamp(a.firstApprovedAt) : 'awaiting'}
      </Row>
      <Row label="Second approver" id={`text-second-${a.id}`}>
        {a.secondApprovedAt ? stamp(a.secondApprovedAt) : 'awaiting'}
      </Row>
      {a.revokedAt && (
        <Row label="Revoked" id={`text-revoked-${a.id}`}>
          {stamp(a.revokedAt)}
        </Row>
      )}
      {a.consumedAt && (
        <Row label="Authorization consumed" id={`text-consumed-${a.id}`}>
          {stamp(a.consumedAt)}
        </Row>
      )}
    </dl>
  );
}

function ConfirmPanel({
  id,
  action,
  prefix,
  pending,
  onConfirm,
  onCancel,
}: {
  id: string;
  action: 'revoke' | 'consume';
  prefix: string;
  pending: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const label = action === 'consume' ? 'Confirm consumption' : 'Confirm revoke';
  return (
    <div
      className="mt-3 space-y-2 border-l-2 border-primary bg-primary/[0.05] p-3 text-sm"
      data-testid={`panel-confirm-${id}`}
    >
      <p>{confirmCopy[action]}</p>
      <label className="block text-xs text-muted-foreground">
        Type the first 8 digest characters ({prefix}) to confirm
        <input
          className="mt-1 block w-40 rounded-sm border border-input bg-background px-2 py-1 font-mono text-xs"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          data-testid={`input-confirm-${id}`}
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          className={cn(btn, 'border-foreground bg-foreground text-background')}
          disabled={typed !== prefix || pending}
          onClick={onConfirm}
          data-testid={`button-confirm-${id}`}
        >
          {pending ? 'Recording…' : label}
        </button>
        <button
          type="button"
          className={btn}
          disabled={pending}
          onClick={onCancel}
          data-testid={`button-cancel-${id}`}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

export function DatabaseApprovalCard({
  approval: a,
  slot,
}: {
  approval: DatabaseApproval;
  slot: Slot;
}) {
  const act = useApprovalAction();
  const [confirming, setConfirming] = useState<'revoke' | 'consume' | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const can = permissions(a, slot);
  const busy = act.isPending;

  function run(action: Action) {
    setError(null);
    act.mutate(
      { id: a.id, data: { action, digest: a.digest } },
      {
        onSuccess: () => setConfirming(null),
        onError: (err) => setError(errorText(err)),
      },
    );
  }

  return (
    <article
      className="border border-border bg-card p-5"
      data-testid={`card-approval-${a.id}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-display text-lg font-bold">
          {operationLabel(a.operation)}{' '}
          <span className="font-mono text-sm font-normal">{a.target}</span>
        </div>
        <span
          className={cn(
            'rounded-sm border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider',
            tone[can.status],
          )}
          data-testid={`status-approval-${a.id}`}
        >
          {can.status === 'consumed'
            ? 'consumed, not executed by Glyph'
            : can.status}
        </span>
      </div>
      <ApprovalDetails a={a} />
      {can.live && (
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className={cn(
              btn,
              'border-primary bg-primary text-primary-foreground',
            )}
            disabled={!can.approve || busy}
            onClick={() => run('approve')}
            data-testid={`button-approve-${a.id}`}
          >
            {can.approvedByMe
              ? 'You approved'
              : `Approve as ${slot ?? '—'} approver`}
          </button>
          <button
            type="button"
            className={btn}
            disabled={!can.consume || busy}
            onClick={() => setConfirming('consume')}
            data-testid={`button-consume-${a.id}`}
          >
            Mark authorization consumed
          </button>
          <button
            type="button"
            className={cn(btn, 'border-destructive/50 text-destructive')}
            disabled={!can.revoke || busy}
            onClick={() => setConfirming('revoke')}
            data-testid={`button-revoke-${a.id}`}
          >
            Revoke
          </button>
        </div>
      )}
      {confirming && can.live && (
        <ConfirmPanel
          key={confirming}
          id={a.id}
          action={confirming}
          prefix={a.digest.slice(0, 8)}
          pending={busy}
          onConfirm={() => run(confirming)}
          onCancel={() => setConfirming(null)}
        />
      )}
      {error && (
        <p
          role="alert"
          className="mt-3 text-sm text-destructive"
          data-testid={`text-action-error-${a.id}`}
        >
          {error}
        </p>
      )}
    </article>
  );
}
