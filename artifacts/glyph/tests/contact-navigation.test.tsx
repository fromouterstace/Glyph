import {
  act,
  cleanup,
  fireEvent,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { journey, profile } from './helpers/contact-journey';

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ isLoaded: true, isSignedIn: true }),
}));
vi.mock('../src/components/label-import', () => ({
  LabelImportPanel: () => null,
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

it('opens a contact through its real link, router, generated client and JSON response', async () => {
  const h = journey();
  const link = await screen.findByTestId('link-contact-c1');
  expect(link.tagName).toBe('A');
  expect(link.getAttribute('href')).toBe('/contacts/c1');
  link.focus();
  expect(document.activeElement).toBe(link);
  fireEvent.click(link);
  await screen.findByRole('heading', { name: 'Contact c1' });
  expect(window.location.pathname).toBe('/contacts/c1');
  expect(h.requests.some((u) => u.pathname === '/api/glyph/contacts/c1')).toBe(
    true,
  );
  h.client.clear();
});

it('keeps message and event pagination independent and resets both on A to B to A navigation', async () => {
  const h = journey('/contacts/c1');
  await screen.findByRole('heading', { name: 'Contact c1' });
  fireEvent.click(screen.getByTestId('button-messages-older'));
  await waitFor(() =>
    expect(h.requests.at(-1)?.searchParams.get('messageOffset')).toBe('25'),
  );
  await waitFor(() =>
    expect(
      screen.getByTestId('button-events-older').hasAttribute('disabled'),
    ).toBe(false),
  );
  fireEvent.click(screen.getByTestId('button-events-older'));
  await waitFor(() =>
    expect(h.requests.at(-1)?.searchParams.get('eventOffset')).toBe('50'),
  );
  expect(h.requests.at(-1)?.searchParams.get('messageOffset')).toBe('25');
  act(() => window.history.pushState(null, '', '/contacts/c2'));
  await screen.findByRole('heading', { name: 'Contact c2' });
  act(() => window.history.pushState(null, '', '/contacts/c1'));
  await screen.findByRole('heading', { name: 'Contact c1' });
  expect(
    screen.getByTestId('button-messages-newer').hasAttribute('disabled'),
  ).toBe(true);
  expect(
    screen.getByTestId('button-events-newer').hasAttribute('disabled'),
  ).toBe(true);
  h.client.clear();
});

it('does not display the previous contact while the next contact is loading', async () => {
  const h = journey('/contacts/c1');
  await screen.findByRole('heading', { name: 'Contact c1' });
  let resolve!: (response: Response) => void;
  h.fetcher.mockImplementationOnce(
    () =>
      new Promise<Response>((done) => {
        resolve = done;
      }),
  );
  act(() => window.history.pushState(null, '', '/contacts/c2'));
  expect(screen.getByTestId('state-loading')).toBeTruthy();
  expect(screen.queryByRole('heading', { name: 'Contact c1' })).toBeNull();
  await act(async () =>
    resolve(
      new Response(JSON.stringify(profile('c2')), {
        headers: { 'content-type': 'application/json' },
      }),
    ),
  );
  await screen.findByRole('heading', { name: 'Contact c2' });
  h.client.clear();
});

it('uses finite polling and displays a subsequent server response without losing pagination', async () => {
  const h = journey('/contacts/c1');
  await screen.findByRole('heading', { name: 'Contact c1' });
  const query = h.client.getQueryCache().findAll()[0];
  expect(query.options).toMatchObject({ refetchInterval: 10_000 });
  h.state.loads = 3;
  await act(async () => {
    await h.client.invalidateQueries();
  });
  await waitFor(() =>
    expect(screen.getByTestId('stat-pixel-loads').textContent).toBe('3'),
  );
  h.client.clear();
});

it('shows missing contacts as not found without retaining the former profile', async () => {
  const h = journey('/contacts/c1');
  await screen.findByRole('heading', { name: 'Contact c1' });
  h.state.status = 404;
  act(() => window.history.pushState(null, '', '/contacts/missing'));
  await screen.findByText('Contact not found');
  expect(screen.queryByRole('heading', { name: 'Contact c1' })).toBeNull();
  h.client.clear();
});

it('offers retry after a server failure and recovers to the real response', async () => {
  const h = journey('/contacts/c1');
  await screen.findByRole('heading', { name: 'Contact c1' });
  h.state.status = 500;
  await act(async () => {
    await h.client.invalidateQueries();
  });
  await screen.findByTestId('state-error');
  h.state.status = 200;
  fireEvent.click(screen.getByTestId('button-retry'));
  await screen.findByRole('heading', { name: 'Contact c1' });
  h.client.clear();
});
