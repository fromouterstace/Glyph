import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SyncGmailButton } from '../src/components/gmail-sync';

const mocks = vi.hoisted(() => ({
  mutate: vi.fn(),
  toast: vi.fn(),
  invalidate: vi.fn(),
}));
vi.mock('@workspace/api-client-react', () => ({
  useSyncNativeMessages: () => ({ mutate: mocks.mutate, isPending: false }),
}));
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock('@/lib/glyph', () => ({
  useSession: () => ({ isSignedIn: true }),
  useInvalidateAll: () => mocks.invalidate,
  errorText: (error: Error) => error.message,
}));
afterEach(cleanup);
beforeEach(() => vi.clearAllMocks());

const result = {
  confirmed: 0,
  pending: 0,
  repliesDetected: 0,
  replyCheckPartial: true,
  replyCheckError: null as string | null,
};
function complete(overrides = {}) {
  mocks.mutate.mockImplementation(
    (
      _value: unknown,
      callbacks: { onSuccess: (value: typeof result) => void },
    ) => callbacks.onSuccess({ ...result, ...overrides }),
  );
  render(<SyncGmailButton />);
  fireEvent.click(screen.getByTestId('button-sync-gmail'));
}

test('rate-limited reply checks show paused status rather than a failed no-replies claim', () => {
  complete({
    replyCheckError:
      'Gmail checks are temporarily rate-limited. Try again in 60 seconds.',
  });
  expect(mocks.toast).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'No new sends confirmed. Reply checks paused',
      variant: 'default',
    }),
  );
});

test('a budget-limited reply pass discloses that some headers remain unchecked', () => {
  complete();
  expect(mocks.toast).toHaveBeenCalledWith(
    expect.objectContaining({
      description: expect.stringContaining('Some replies remain unchecked.'),
    }),
  );
});

test('ordinary reply-check failures retain their actual failure state', () => {
  complete({ replyCheckError: 'Permission denied' });
  expect(mocks.toast).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'No new sends confirmed. Reply checks failed',
      variant: 'destructive',
    }),
  );
});

test('a send-status check blocked by cooldown also shows paused status', () => {
  mocks.mutate.mockImplementation(
    (_value: unknown, callbacks: { onError: (error: Error) => void }) =>
      callbacks.onError(
        new Error(
          'Gmail checks are temporarily rate-limited. Try again in 60 seconds.',
        ),
      ),
  );
  render(<SyncGmailButton />);
  fireEvent.click(screen.getByTestId('button-sync-gmail'));
  expect(mocks.toast).toHaveBeenCalledWith(
    expect.objectContaining({
      title: 'Gmail checks paused',
      variant: 'default',
    }),
  );
});
