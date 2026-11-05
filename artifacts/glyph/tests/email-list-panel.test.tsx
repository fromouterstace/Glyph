import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { AnchorHTMLAttributes } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '@workspace/api-client-react';
import {
  EmailListPanel,
  type MessageListQuery,
} from '../src/components/email-list-panel';

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
}));

afterEach(cleanup);

const message: Message = {
  id: 'message-1',
  recipientEmail: 'recipient@example.invalid',
  recipientName: 'Recipient',
  subject: 'A tracked email',
  body: 'Hello',
  trackOpens: true,
  trackClicks: true,
  status: 'sent',
  createdAt: '2026-11-04T12:00:00.000Z',
  sentAt: null,
  opens: 0,
  clicks: 0,
  replies: 0,
  lastActivityAt: null,
  deliverySource: 'gmail',
};

function renderPanel({
  offset = 50,
  total = 125,
  hasMore = true,
  onOffsetChange = vi.fn(),
}: {
  offset?: number;
  total?: number;
  hasMore?: boolean;
  onOffsetChange?: (offset: number) => void;
} = {}) {
  const list = {
    isLoading: false,
    isError: false,
    data: {
      items: [message],
      pagination: { limit: 50, offset, total, hasMore },
    },
    refetch: vi.fn(),
  } as unknown as MessageListQuery;
  render(
    <EmailListPanel
      list={list}
      search=""
      onSearchChange={vi.fn()}
      status="all"
      onStatusChange={vi.fn()}
      isSignedIn
      offset={offset}
      onOffsetChange={onOffsetChange}
      hasActiveFilters={false}
      onCompose={vi.fn()}
    />,
  );
  return { onOffsetChange };
}

describe('email list pagination', () => {
  it('shows the current page range separately from the total', () => {
    renderPanel();
    expect(screen.getByText('51–51 of 125')).toBeTruthy();
  });

  it('advances by one page when Older is clicked', () => {
    const { onOffsetChange } = renderPanel();
    fireEvent.click(screen.getByTestId('button-next-messages'));
    expect(onOffsetChange).toHaveBeenCalledWith(100);
  });

  it('discloses and enforces the history browsing cap', () => {
    renderPanel({ offset: 10_000, total: 20_000 });
    expect(
      screen.getByText(/Older records remain stored; browsing stops/),
    ).toBeTruthy();
    expect(
      (screen.getByTestId('button-next-messages') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
