import './database-approvals-setup';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { DatabaseApprovalCard } from '@/components/database-approval-card';
import { approval, DIGEST, hooks, wrap } from './database-approvals-mocks';

beforeEach(() => {
  hooks.act.mockReset();
  hooks.pending = false;
});
afterEach(cleanup);
const both = {
  status: 'approved',
  firstApprovedAt: new Date().toISOString(),
  secondApprovedAt: new Date().toISOString(),
};

it('approves bound to the record digest', () => {
  wrap(<DatabaseApprovalCard approval={approval() as never} slot="second" />);
  fireEvent.click(screen.getByTestId('button-approve-apr-1'));
  expect(hooks.act).toHaveBeenCalledWith(
    { id: 'apr-1', data: { action: 'approve', digest: DIGEST } },
    expect.anything(),
  );
});

it('does not allow the same slot to approve twice', () => {
  wrap(
    <DatabaseApprovalCard
      approval={
        approval({ firstApprovedAt: new Date().toISOString() }) as never
      }
      slot="first"
    />,
  );
  expect(
    (screen.getByTestId('button-approve-apr-1') as HTMLButtonElement).disabled,
  ).toBe(true);
});

it('requires typed digest confirmation before consuming', () => {
  wrap(
    <DatabaseApprovalCard approval={approval(both) as never} slot="first" />,
  );
  fireEvent.click(screen.getByTestId('button-consume-apr-1'));
  expect(screen.getByTestId('panel-confirm-apr-1').textContent).toMatch(
    /does not run any SQL/,
  );
  const confirm = screen.getByTestId(
    'button-confirm-apr-1',
  ) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  fireEvent.change(screen.getByTestId('input-confirm-apr-1'), {
    target: { value: DIGEST.slice(0, 8) },
  });
  fireEvent.click(confirm);
  expect(hooks.act).toHaveBeenCalledWith(
    { id: 'apr-1', data: { action: 'consume', digest: DIGEST } },
    expect.anything(),
  );
});

it('shows action failures without claiming success', () => {
  hooks.act.mockImplementation((_v, o) =>
    o.onError({ status: 409, data: { error: 'Digest mismatch' } }),
  );
  wrap(<DatabaseApprovalCard approval={approval() as never} slot="first" />);
  fireEvent.click(screen.getByTestId('button-approve-apr-1'));
  expect(screen.getByTestId('text-action-error-apr-1').textContent).toBe(
    'Digest mismatch',
  );
  expect(screen.getByTestId('status-approval-apr-1').textContent).toBe(
    'pending',
  );
});

it('disables actions while a mutation is pending and when expired', () => {
  hooks.pending = true;
  wrap(<DatabaseApprovalCard approval={approval() as never} slot="first" />);
  expect(
    (screen.getByTestId('button-approve-apr-1') as HTMLButtonElement).disabled,
  ).toBe(true);
  cleanup();
  hooks.pending = false;
  wrap(
    <DatabaseApprovalCard
      approval={
        approval({
          expiresAt: new Date(Date.now() - 1000).toISOString(),
        }) as never
      }
      slot="first"
    />,
  );
  expect(screen.getByTestId('status-approval-apr-1').textContent).toBe(
    'expired',
  );
  expect(screen.queryByTestId('button-approve-apr-1')).toBeNull();
});

it('labels consumed records as not executed', () => {
  wrap(
    <DatabaseApprovalCard
      approval={
        approval({
          ...both,
          status: 'consumed',
          consumedAt: new Date().toISOString(),
        }) as never
      }
      slot="first"
    />,
  );
  expect(screen.getByTestId('status-approval-apr-1').textContent).toMatch(
    /not executed/,
  );
});
