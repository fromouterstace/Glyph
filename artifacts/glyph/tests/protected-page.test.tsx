import { lazy } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { ProtectedPage } from '@/components/protected-page';

const state = vi.hoisted(() => ({ signedIn: false, path: '/emails' }));
vi.mock('wouter', () => ({ useLocation: () => [state.path] }));
vi.mock('@/components/auth-gate', () => ({
  AuthGate: ({ children }: { children: React.ReactNode }) =>
    state.signedIn ? children : <p>Sign in required</p>,
}));
vi.mock('@/components/shell', () => ({
  Shell: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="shell">{children}</div>
  ),
}));

beforeEach(() => {
  state.signedIn = false;
  state.path = '/emails';
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it('does not load protected page code before sign-in', () => {
  const load = vi.fn(async () => ({ default: () => <p>Private page</p> }));
  const Page = lazy(load);
  render(
    <ProtectedPage>
      <Page />
    </ProtectedPage>,
  );
  expect(screen.getByText('Sign in required')).toBeTruthy();
  expect(load).not.toHaveBeenCalled();
});

it('keeps the shell visible while loading, then displays the resolved page', async () => {
  state.signedIn = true;
  const pending = Promise.withResolvers<{ default: () => React.ReactNode }>();
  const Page = lazy(() => pending.promise);
  render(
    <ProtectedPage>
      <Page />
    </ProtectedPage>,
  );
  expect(screen.getByTestId('shell')).toBeTruthy();
  expect(screen.getByRole('status').textContent).toContain('Loading page');
  pending.resolve({ default: () => <h1>Emails loaded</h1> });
  await screen.findByRole('heading', { name: 'Emails loaded' });
  expect(screen.queryByRole('status')).toBeNull();
});

it('shows an explicit reload action on chunk failure and recovers on navigation', async () => {
  state.signedIn = true;
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const Page = lazy(async () => {
    throw new Error('private chunk URL');
  });
  const view = render(
    <ProtectedPage>
      <Page />
    </ProtectedPage>,
  );
  await screen.findByRole('alert');
  expect(screen.getByRole('button', { name: 'Reload page' })).toBeTruthy();
  expect(screen.queryByText('private chunk URL')).toBeNull();
  state.path = '/settings';
  view.rerender(
    <ProtectedPage>
      <h1>Settings loaded</h1>
    </ProtectedPage>,
  );
  await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
  expect(screen.getByRole('heading', { name: 'Settings loaded' })).toBeTruthy();
});
