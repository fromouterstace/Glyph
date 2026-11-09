import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContactDetail } from '@workspace/api-client-react';
import { ContactProfileView } from '../src/pages/contact-detail';
import { safeHref } from '../src/components/contact-profile';

vi.mock('wouter', () => ({
  Link: ({
    href,
    children,
    ...props
  }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
  useParams: () => ({}),
}));

afterEach(cleanup);

const base: ContactDetail = {
  contact: {
    id: 'c1',
    firstName: 'Test',
    lastName: 'Person',
    email: 'person@example.invalid',
    emailSuffix: 'example.invalid',
    createdAt: '2026-01-02T03:04:05.000Z',
  },
  lastCommunicationAt: null,
  daysSinceLastCommunication: null,
  totalMessages: 0,
  messages: [],
  messageOffset: 0,
  messageLimit: 25,
  totalEvents: 0,
  events: [],
  eventOffset: 0,
  eventLimit: 50,
  pixelLoads: 0,
  linkRequests: 0,
  replies: 0,
};

const view = (d: ContactDetail, onE = vi.fn()) =>
  render(
    <ContactProfileView
      detail={d}
      busy={false}
      onMessageOffset={vi.fn()}
      onEventOffset={onE}
    />,
  );

const rich: ContactDetail = {
  ...base,
  daysSinceLastCommunication: 3,
  lastCommunicationAt: '2026-02-01T10:00:00.000Z',
  totalMessages: 1,
  messages: [
    {
      id: 'm1',
      subject: 'Hello',
      excerpt: 'Hi',
      sentAt: '2026-02-01T10:00:00.000Z',
      createdAt: '2026-02-01T09:00:00.000Z',
      deliverySource: 'import',
      status: 'sent',
      trackOpens: false,
      trackClicks: false,
    },
  ],
  totalEvents: 2,
  events: [
    {
      id: 'e1',
      messageId: 'm1',
      subject: 'Hello',
      type: 'click',
      occurredAt: '2026-02-02T10:00:00.000Z',
      url: 'https://example.invalid/a',
      automated: false,
      source: 'redirect',
    },
    {
      id: 'e2',
      messageId: 'm1',
      subject: 'Hello',
      type: 'click',
      occurredAt: '2026-02-02T11:00:00.000Z',
      url: 'javascript:alert(1)',
      automated: true,
      source: 'redirect',
    },
  ],
};

describe('ContactProfileView', () => {
  it('shows a composed state for a contact with no communication', () => {
    view(base);
    expect(screen.getByTestId('stat-days-since').textContent).toBe(
      'No communication recorded',
    );
    expect(screen.getByText('No correspondence')).toBeTruthy();
    expect(screen.getByText('No signals recorded')).toBeTruthy();
    expect(screen.getByText(/not verified reads/)).toBeTruthy();
  });
});

describe('ContactProfileView signals', () => {
  it('links messages and renders only http(s) destinations as links', () => {
    view(rich);
    expect(screen.getByTestId('stat-days-since').textContent).toBe(
      '3 days ago',
    );
    expect(
      screen.getByTestId('link-contact-message-m1').getAttribute('href'),
    ).toBe('/emails/m1');
    expect(screen.getByTestId('text-tracking-m1').textContent).toBe(
      'No historical tracking',
    );
    const links = screen.getAllByTestId('link-event-url');
    expect(links).toHaveLength(1);
    expect(links[0].getAttribute('href')).toBe('https://example.invalid/a');
    expect(screen.getByText('javascript:alert(1)').tagName).toBe('SPAN');
    expect(screen.getAllByText('Link request')).toHaveLength(2);
    expect(screen.getByText(/Likely automated/)).toBeTruthy();
  });
});

describe('ContactProfileView paging', () => {
  it('pages events separately', () => {
    const onE = vi.fn();
    view({ ...base, totalEvents: 120, events: [] }, onE);
    fireEvent.click(screen.getByTestId('button-events-older'));
    expect(onE).toHaveBeenCalledWith(50);
    expect(screen.queryByTestId('button-messages-older')).toBeNull();
  });

  it('rejects non-web URLs', () => {
    expect(safeHref('data:text/html,x')).toBeNull();
    expect(safeHref('http://a.invalid/')).toBe('http://a.invalid/');
  });
});
