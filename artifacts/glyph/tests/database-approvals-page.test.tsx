import './database-approvals-setup';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import DatabaseApprovalsPage from '@/pages/database-approvals';
import { approval, hooks, wrap } from './database-approvals-mocks';

beforeEach(() => {
  hooks.create.mockReset();
  hooks.options.length = 0;
  hooks.pending = false;
  hooks.access.data = { canApprove: true, slot: 'first' };
  hooks.list.data = { items: [approval()], offset: 0, hasMore: false };
});
afterEach(cleanup);

it('denies access when the server says canApprove is false', () => {
  hooks.access.data = { canApprove: false, slot: null };
  wrap(<DatabaseApprovalsPage />);
  expect(screen.getByTestId('state-approval-denied')).toBeTruthy();
  expect(screen.queryByTestId('form-approval')).toBeNull();
});

it('keys queries by Clerk user, polls, and disables mutation retries', () => {
  wrap(<DatabaseApprovalsPage />);
  const keys = hooks.options.map((o) =>
    JSON.stringify(
      (o as { query?: { queryKey?: unknown } }).query?.queryKey ?? null,
    ),
  );
  expect(keys.some((k) => k.includes('access') && k.includes('user_a'))).toBe(
    true,
  );
  expect(
    keys.some((k) => k.includes('{"offset":0}') && k.includes('user_a')),
  ).toBe(true);
  const mutations = hooks.options.filter(
    (o) => (o as { mutation?: unknown }).mutation,
  );
  expect(
    mutations.every(
      (o) => (o as { mutation: { retry: unknown } }).mutation.retry === false,
    ),
  ).toBe(true);
  expect(screen.getByText(/never execute SQL/)).toBeTruthy();
});

it('creates a request with only operation, target, plan hash and reason', () => {
  wrap(<DatabaseApprovalsPage />);
  fireEvent.change(screen.getByTestId('select-operation'), {
    target: { value: 'drop_object' },
  });
  fireEvent.change(screen.getByTestId('input-target'), {
    target: { value: 'public.old_view' },
  });
  fireEvent.change(screen.getByTestId('input-plan-sha'), {
    target: { value: 'A'.repeat(64) },
  });
  fireEvent.change(screen.getByTestId('input-reason'), {
    target: { value: 'Remove unused legacy view' },
  });
  fireEvent.click(screen.getByTestId('button-create-approval'));
  expect(hooks.create).toHaveBeenCalledWith(
    {
      data: {
        operation: 'drop_object',
        target: 'public.old_view',
        planSha256: 'a'.repeat(64),
        reason: 'Remove unused legacy view',
      },
    },
    expect.anything(),
  );
});

it('rejects an invalid plan hash and keeps the edits', () => {
  wrap(<DatabaseApprovalsPage />);
  fireEvent.change(screen.getByTestId('input-target'), {
    target: { value: 'public.t' },
  });
  fireEvent.change(screen.getByTestId('input-plan-sha'), {
    target: { value: 'nothex' },
  });
  fireEvent.click(screen.getByTestId('button-create-approval'));
  expect(hooks.create).not.toHaveBeenCalled();
  expect(screen.getByTestId('text-form-error').textContent).toMatch(/SHA-256/);
  expect((screen.getByTestId('input-target') as HTMLInputElement).value).toBe(
    'public.t',
  );
});

it('shows a create failure from the server', () => {
  hooks.create.mockImplementation((_v, o) =>
    o.onError({ status: 403, data: { error: 'Not a designated approver' } }),
  );
  wrap(<DatabaseApprovalsPage />);
  fireEvent.change(screen.getByTestId('input-target'), {
    target: { value: 'public.t' },
  });
  fireEvent.change(screen.getByTestId('input-plan-sha'), {
    target: { value: 'b'.repeat(64) },
  });
  fireEvent.change(screen.getByTestId('input-reason'), {
    target: { value: 'A valid long reason' },
  });
  fireEvent.click(screen.getByTestId('button-create-approval'));
  expect(screen.getByTestId('text-form-error').textContent).toBe(
    'Not a designated approver',
  );
});
