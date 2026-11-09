import { vi } from 'vitest';
import { render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';

export const DIGEST = 'abcdef12'.padEnd(64, '0');
export function approval(over: Record<string, unknown> = {}) {
  return {
    id: 'apr-1',
    operation: 'delete_rows',
    target: 'public.tracking_events',
    planSha256: 'f'.repeat(64),
    reason: 'Purge rows past retention window',
    digest: DIGEST,
    environment: 'production',
    requestedBy: 'maintainer-a',
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    firstApprovedAt: null,
    secondApprovedAt: null,
    revokedAt: null,
    consumedAt: null,
    status: 'pending',
    ...over,
  };
}

export const hooks = {
  access: {
    isPending: false,
    isError: false,
    data: { canApprove: true, slot: 'first' } as unknown,
    refetch: vi.fn(),
  },
  list: {
    isPending: false,
    isError: false,
    isFetching: false,
    data: { items: [] as unknown[], offset: 0, hasMore: false },
    refetch: vi.fn(),
  },
  create: vi.fn(),
  act: vi.fn(),
  pending: false,
  options: [] as unknown[],
};

export function wrap(ui: ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>{ui}</QueryClientProvider>,
  );
}
