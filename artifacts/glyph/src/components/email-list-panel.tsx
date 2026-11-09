import { Search } from 'lucide-react';
import { Link } from 'wouter';
import type {
  ListMessagesQueryResult,
  Message,
} from '@workspace/api-client-react';
import { ImportedTag, isImported } from '@/components/label-import';
import { Avatar, EmptyState, ErrorState, StatusPill } from '@/components/bits';
import { MessageEngagement } from '@/components/engagement';
import { HistoryPagination } from '@/components/history-pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { ago, errorText } from '@/lib/glyph';
import { cn } from '@/lib/utils';

export const MESSAGE_STATUSES = [
  'all',
  'draft',
  'sent',
  'sending',
  'uncertain',
  'failed',
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export type MessageListQuery = {
  data?: ListMessagesQueryResult;
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
};

type EmailListPanelProps = {
  list: MessageListQuery;
  search: string;
  onSearchChange: (value: string) => void;
  status: MessageStatus;
  onStatusChange: (status: MessageStatus) => void;
  selected?: string;
  isSignedIn: boolean;
  offset: number;
  onOffsetChange: (offset: number) => void;
  hasActiveFilters: boolean;
  onCompose: () => void;
};

export function EmailListPanel(props: EmailListPanelProps) {
  const {
    list,
    search,
    onSearchChange,
    status,
    onStatusChange,
    selected,
    isSignedIn,
    offset,
    onOffsetChange,
    hasActiveFilters,
    onCompose,
  } = props;
  const pagination = list.data?.pagination;
  const rows = list.data?.items ?? [];

  return (
    <div
      className={cn('border-border lg:border-r', selected && 'hidden lg:block')}
    >
      <div className="space-y-3 border-b border-border p-3">
        <label className="flex items-center gap-2 rounded-sm border border-input bg-background px-3 focus-within:border-primary">
          <Search className="size-4 text-muted-foreground" />
          <input
            data-testid="input-search"
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search recipient or subject"
            className="h-9 w-full bg-transparent text-sm outline-none"
          />
        </label>
        <div className="flex flex-wrap gap-1">
          {MESSAGE_STATUSES.map((value) => (
            <button
              key={value}
              data-testid={`filter-${value}`}
              onClick={() => onStatusChange(value)}
              className={cn(
                'rounded-sm px-2 py-1 font-mono text-[10px] uppercase tracking-wider transition-colors',
                status === value
                  ? 'bg-foreground text-background'
                  : 'text-muted-foreground hover:bg-muted',
              )}
            >
              {value}
            </button>
          ))}
        </div>
      </div>
      <MessageListState
        list={list}
        rows={rows}
        selected={selected}
        isSignedIn={isSignedIn}
        hasActiveFilters={hasActiveFilters}
        onCompose={onCompose}
      />
      {pagination && (
        <HistoryPagination
          scope="messages"
          unit="messages"
          offset={offset}
          total={pagination.total}
          itemCount={rows.length}
          hasMore={pagination.hasMore}
          onOffsetChange={onOffsetChange}
          capMessage="Older records remain stored; browsing stops at the 10,000 offset limit. All-time totals remain complete."
        />
      )}
    </div>
  );
}

function MessageListState({
  list,
  rows,
  selected,
  isSignedIn,
  hasActiveFilters,
  onCompose,
}: {
  list: MessageListQuery;
  rows: Message[];
  selected?: string;
  isSignedIn: boolean;
  hasActiveFilters: boolean;
  onCompose: () => void;
}) {
  if (list.isLoading) {
    return (
      <div className="space-y-2 p-3">
        {[0, 1, 2, 3, 4].map((index) => (
          <Skeleton key={index} className="h-14" />
        ))}
      </div>
    );
  }
  if (list.isError) {
    return (
      <div className="p-3">
        <ErrorState
          error={errorText(list.error)}
          onRetry={() => list.refetch()}
        />
      </div>
    );
  }
  if (!rows.length) {
    return (
      <EmptyState
        title={hasActiveFilters ? 'No matches' : 'No tracked emails'}
        body={
          hasActiveFilters
            ? 'Try a different search or filter.'
            : 'Messages you glyph inside Gmail appear here. The web composer above is a secondary option.'
        }
        action={
          isSignedIn && !hasActiveFilters ? (
            <button
              onClick={onCompose}
              data-testid="button-compose-empty"
              className="rounded-sm bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
            >
              Compose
            </button>
          ) : undefined
        }
      />
    );
  }
  return <MessageRows rows={rows} selected={selected} />;
}

function MessageRows({
  rows,
  selected,
}: {
  rows: Message[];
  selected?: string;
}) {
  return (
    <ul className="max-h-[70dvh] divide-y divide-border overflow-y-auto">
      {rows.map((message) => (
        <li key={message.id}>
          <Link
            href={`/emails/${message.id}`}
            data-testid={`row-email-${message.id}`}
            className={cn(
              'flex gap-3 px-3 py-3 transition-colors hover:bg-muted/50',
              selected === message.id &&
                'bg-muted shadow-[inset_2px_0_0_hsl(var(--primary))]',
            )}
          >
            <Avatar
              name={message.recipientName}
              email={message.recipientEmail}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium">
                  {message.recipientName || message.recipientEmail}
                </span>
                {isImported(message) && <ImportedTag compact />}
                {message.deliverySource === 'gmail' && (
                  <span className="rounded-sm bg-secondary px-1 font-mono text-[9px] uppercase text-muted-foreground">
                    gmail
                  </span>
                )}
                <span className="ml-auto shrink-0 font-mono text-[10px] text-muted-foreground">
                  {ago(message.sentAt ?? message.createdAt)}
                </span>
              </div>
              <div className="truncate text-xs text-foreground/80">
                {message.subject}
              </div>
              {!isImported(message) && (
                <div className="mt-1.5 flex min-w-0 flex-wrap items-center gap-1.5">
                  {(message.deliverySource !== 'gmail' ||
                    message.status === 'sent') &&
                    message.status !== 'sent' && (
                      <StatusPill status={message.status} />
                    )}
                  {(message.status !== 'draft' ||
                    message.deliverySource === 'gmail') && (
                    <MessageEngagement m={message} compact />
                  )}
                </div>
              )}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
