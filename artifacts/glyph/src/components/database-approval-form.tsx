import { useState, type FormEvent } from 'react';
import { FilePlus2 } from 'lucide-react';
import { errorText } from '@/lib/glyph';
import {
  OPERATIONS,
  SHA_PATTERN,
  TARGET_PATTERN,
  useCreateApproval,
  type ApprovalOperation,
} from '@/lib/database-approvals';

const field =
  'w-full rounded-sm border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring/40';

function validate(target: string, sha: string, reason: string) {
  if (!target || target.length > 200 || !TARGET_PATTERN.test(target))
    return 'Target must be 1-200 characters: letters, digits, _ . : -';
  if (!SHA_PATTERN.test(sha))
    return 'Plan SHA-256 must be 64 lowercase hexadecimal characters.';
  if (reason.trim().length < 10 || reason.length > 2000)
    return 'Reason must be 10-2000 characters.';
  return null;
}

export function DatabaseApprovalForm() {
  const create = useCreateApproval();
  const [operation, setOperation] = useState<ApprovalOperation>('delete_rows');
  const [target, setTarget] = useState('');
  const [sha, setSha] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [createdId, setCreatedId] = useState<string | null>(null);

  function submit(e: FormEvent) {
    e.preventDefault();
    if (create.isPending) return;
    const planSha256 = sha.trim().toLowerCase();
    const issue = validate(target.trim(), planSha256, reason);
    setProblem(issue);
    setCreatedId(null);
    if (issue) return;
    create.mutate(
      {
        data: {
          operation,
          target: target.trim(),
          planSha256,
          reason: reason.trim(),
        },
      },
      {
        onSuccess: (a) => {
          setCreatedId(a.id);
          setTarget('');
          setSha('');
          setReason('');
        },
        onError: (err) => setProblem(errorText(err)),
      },
    );
  }

  return (
    <form
      onSubmit={submit}
      className="space-y-4 border border-border bg-card p-5"
      data-testid="form-approval"
    >
      <div className="flex items-center gap-2 font-semibold">
        <FilePlus2 className="size-4 text-primary" /> New protected-operation
        request
      </div>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Operation</span>
        <select
          data-testid="select-operation"
          className={field}
          value={operation}
          disabled={create.isPending}
          onChange={(e) => setOperation(e.target.value as ApprovalOperation)}
        >
          {OPERATIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Target</span>
        <input
          data-testid="input-target"
          className={`${field} font-mono`}
          value={target}
          maxLength={200}
          placeholder="public.tracking_events"
          disabled={create.isPending}
          onChange={(e) => setTarget(e.target.value)}
        />
      </label>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Plan SHA-256</span>
        <input
          data-testid="input-plan-sha"
          className={`${field} font-mono text-xs`}
          value={sha}
          maxLength={64}
          placeholder="64 hex characters of the reviewed plan"
          disabled={create.isPending}
          onChange={(e) => setSha(e.target.value)}
        />
        <span className="block text-xs text-muted-foreground">
          Hash the reviewed plan outside Glyph. SQL text is never accepted here.
        </span>
      </label>
      <label className="block space-y-1.5 text-sm">
        <span className="font-medium">Reason</span>
        <textarea
          data-testid="input-reason"
          className={`${field} min-h-24`}
          value={reason}
          maxLength={2000}
          disabled={create.isPending}
          onChange={(e) => setReason(e.target.value)}
        />
      </label>
      <p className="text-xs text-muted-foreground">
        The server assigns the requester, environment, digest and a one-hour
        expiry. None can be chosen here.
      </p>
      {problem && (
        <p
          role="alert"
          className="text-sm text-destructive"
          data-testid="text-form-error"
        >
          {problem}
        </p>
      )}
      {createdId && (
        <p
          role="status"
          className="text-sm text-[hsl(176_45%_28%)]"
          data-testid="text-form-created"
        >
          Request recorded. It needs approval from both designated accounts.
        </p>
      )}
      <button
        type="submit"
        data-testid="button-create-approval"
        disabled={create.isPending}
        className="rounded-sm bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
      >
        {create.isPending ? 'Recording request…' : 'Record request'}
      </button>
    </form>
  );
}
