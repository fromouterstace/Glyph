import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import { Route, Router, Switch } from 'wouter';
import { vi } from 'vitest';
import type { ContactDetail } from '@workspace/api-client-react';
import ContactsPage from '../../src/pages/contacts';
import ContactDetailPage from '../../src/pages/contact-detail';

export function profile(id = 'c1'): ContactDetail {
  return {
    contact: {
      id,
      firstName: 'Contact',
      lastName: id,
      email: `${id}@example.invalid`,
      emailSuffix: 'example.invalid',
      createdAt: '2026-01-02T03:04:05.000Z',
    },
    lastCommunicationAt: null,
    daysSinceLastCommunication: null,
    totalMessages: 26,
    messages: [],
    messageOffset: 0,
    messageLimit: 25,
    totalEvents: 51,
    events: [],
    eventOffset: 0,
    eventLimit: 50,
    pixelLoads: 0,
    linkRequests: 0,
    replies: 0,
  };
}

export function journey(path = '/contacts') {
  window.history.replaceState(null, '', path);
  const requests: URL[] = [];
  const state = { status: 200, loads: 0 };
  const fetcher = vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input), window.location.origin);
    requests.push(url);
    const id = url.pathname.split('/').at(-1)!;
    const detail = {
      ...profile(id),
      pixelLoads: state.loads,
      messageOffset: Number(url.searchParams.get('messageOffset') ?? 0),
      eventOffset: Number(url.searchParams.get('eventOffset') ?? 0),
    };
    const body =
      state.status !== 200
        ? { error: 'Synthetic request failure' }
        : id === 'contacts'
          ? { contacts: [profile().contact], total: 1, offset: 0, limit: 50 }
          : detail;
    return new Response(JSON.stringify(body), {
      status: state.status,
      headers: { 'content-type': 'application/json' },
    });
  });
  vi.stubGlobal('fetch', fetcher);
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  render(
    <QueryClientProvider client={client}>
      <Router>
        <Switch>
          <Route path="/contacts" component={ContactsPage} />
          <Route path="/contacts/:id" component={ContactDetailPage} />
        </Switch>
      </Router>
    </QueryClientProvider>,
  );
  return { client, fetcher, requests, state };
}
