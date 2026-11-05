import { useState } from 'react';
import {
  getListMessageEventsQueryKey,
  useListMessageEvents,
  type Message,
} from '@workspace/api-client-react';
import { ErrorState } from '@/components/bits';
import { HistoryPagination } from '@/components/history-pagination';
import { SignalTrail } from '@/components/message-summary';
import { Skeleton } from '@/components/ui/skeleton';
import { errorText, usePoll } from '@/lib/glyph';

export function SignalHistory({
  id,
  message,
}: {
  id: string;
  message: Message;
}) {
  const poll = usePoll();
  const [offset, setOffset] = useState(0);
  const page = useListMessageEvents(id, offset, {
    query: {
      refetchInterval: poll,
      queryKey: getListMessageEventsQueryKey(id, offset),
    },
  });

  if (page.isLoading) {
    return (
      <div className="space-y-3 p-5">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-12" />
        <Skeleton className="h-12" />
      </div>
    );
  }
  if (page.isError) {
    return (
      <div className="p-5">
        <ErrorState
          error={errorText(page.error)}
          onRetry={() => page.refetch()}
        />
      </div>
    );
  }
  if (!page.data) {
    return (
      <div className="space-y-3 p-5">
        <Skeleton className="h-4 w-1/3" />
        <Skeleton className="h-12" />
      </div>
    );
  }

  const pagination = page.data.pagination;
  return (
    <>
      <SignalTrail events={page.data.items} message={message} />
      <HistoryPagination
        scope="signals"
        unit="signals"
        offset={offset}
        total={pagination.total}
        itemCount={page.data.items.length}
        hasMore={pagination.hasMore}
        onOffsetChange={setOffset}
        capMessage="Older signals remain stored; browsing stops at the 10,000 offset limit. Message totals remain complete."
        className="px-5 py-3"
      />
    </>
  );
}
