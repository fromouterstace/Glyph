import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GmailAuthorization } from '@/components/gmail-authorization';

const mock = vi.hoisted(() => ({
  data: {
    configured: true,
    connectOrigin: 'http://localhost:3000' as string | null,
    connected: false,
    email: null as string | null,
    kind: 'none',
  },
  begin: vi.fn(),
  disconnect: vi.fn(),
  refetch: vi.fn(),
  error: false,
}));
vi.mock('@workspace/api-client-react', () => ({
  useGetGmailAuthorization: () => ({
    data: mock.data,
    isLoading: false,
    isError: mock.error,
    refetch: mock.refetch,
  }),
  useBeginGmailAuthorization: () => ({
    mutateAsync: mock.begin,
    isPending: false,
  }),
  useDisconnectGmail: () => ({
    mutateAsync: mock.disconnect,
    isPending: false,
  }),
  getGetGmailAuthorizationQueryKey: () => ['gmail-authorization'],
  getGetConnectionQueryKey: () => ['connection'],
}));
vi.mock('@/components/gmail-sync', () => ({
  SyncGmailButton: () => <button>Sync Gmail</button>,
}));
vi.mock('@/lib/glyph', () => ({ errorText: (error: Error) => error.message }));

function show() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  render(
    <QueryClientProvider client={client}>
      <GmailAuthorization />
    </QueryClientProvider>,
  );
  return invalidate;
}
beforeEach(() => {
  vi.clearAllMocks();
  mock.data = {
    configured: true,
    connectOrigin: window.location.origin,
    connected: false,
    email: null,
    kind: 'none',
  };
  mock.error = false;
});
afterEach(cleanup);

it('directs preview users to the configured production Gmail page without starting OAuth', () => {
  mock.data.connectOrigin = 'https://published.example';
  show();
  expect(
    screen
      .getByRole('link', { name: /Open published Glyph/ })
      .getAttribute('href'),
  ).toBe('https://published.example/gmail');
  expect(screen.queryByRole('button', { name: 'Connect Gmail' })).toBeNull();
  expect(mock.begin).not.toHaveBeenCalled();
});

it('shows missing setup and explicit connection-check errors', () => {
  mock.data.configured = false;
  mock.data.connectOrigin = null;
  mock.error = true;
  show();
  expect(
    screen.getByText(/administrator must finish Google OAuth setup/),
  ).toBeTruthy();
  expect(screen.queryByRole('button', { name: 'Connect Gmail' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(mock.refetch).toHaveBeenCalledOnce();
});

it('does not hide an authorization failure or navigate to an untrusted URL', async () => {
  mock.begin.mockResolvedValue({
    authorizationUrl: 'https://attacker.invalid',
  });
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Connect Gmail' }));
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toContain(
      'authorization URL is invalid',
    ),
  );
});

it('requires explicit disconnect confirmation and invalidates connection status after success', async () => {
  mock.data.connected = true;
  mock.data.email = 'owner@example.invalid';
  mock.data.kind = 'personal';
  mock.disconnect.mockResolvedValue({
    disconnected: true,
    revocationConfirmed: false,
  });
  const invalidate = show();
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect Gmail' }));
  expect(mock.disconnect).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(
    screen.queryByRole('button', { name: 'Confirm disconnect' }),
  ).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect Gmail' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm disconnect' }));
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toContain(
      'Google revocation could not be confirmed',
    ),
  );
  expect(invalidate).toHaveBeenCalledWith({
    queryKey: ['gmail-authorization'],
  });
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['connection'] });
});

it('keeps failed disconnect visible rather than claiming credentials were removed', async () => {
  mock.data.connected = true;
  mock.data.kind = 'personal';
  mock.disconnect.mockRejectedValue(new Error('Try disconnecting again'));
  show();
  fireEvent.click(screen.getByRole('button', { name: 'Disconnect Gmail' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirm disconnect' }));
  await waitFor(() =>
    expect(screen.getByRole('status').textContent).toContain(
      'Try disconnecting again',
    ),
  );
  expect(
    screen.getByRole('button', { name: 'Confirm disconnect' }),
  ).toBeTruthy();
});
