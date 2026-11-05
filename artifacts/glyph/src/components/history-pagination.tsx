import { cn } from '@/lib/utils';
import {
  HISTORY_PAGE_SIZE,
  MAX_HISTORY_OFFSET,
} from '@/lib/history-pagination';

export function HistoryPagination({
  scope,
  unit,
  offset,
  total,
  itemCount,
  hasMore,
  onOffsetChange,
  capMessage,
  className,
  noteClassName,
}: {
  scope: 'messages' | 'signals' | 'activity';
  unit: 'messages' | 'signals';
  offset: number;
  total: number;
  itemCount: number;
  hasMore: boolean;
  onOffsetChange: (offset: number) => void;
  capMessage: string;
  className?: string;
  noteClassName?: string;
}) {
  return (
    <>
      <div
        className={cn(
          'flex items-center justify-between gap-2 border-t border-border px-3 py-2 text-xs',
          className,
        )}
      >
        <span className="font-mono text-muted-foreground">
          {total === 0
            ? `0 ${unit}`
            : `${offset + 1}–${Math.min(offset + itemCount, total)} of ${total}`}
        </span>
        <div className="flex gap-1">
          <button
            type="button"
            data-testid={`button-previous-${scope}`}
            disabled={offset === 0}
            onClick={() =>
              onOffsetChange(Math.max(0, offset - HISTORY_PAGE_SIZE))
            }
            className="rounded-sm border border-border px-2 py-1 disabled:opacity-40"
          >
            Newer
          </button>
          <button
            type="button"
            data-testid={`button-next-${scope}`}
            disabled={!hasMore || offset >= MAX_HISTORY_OFFSET}
            onClick={() => onOffsetChange(offset + HISTORY_PAGE_SIZE)}
            className="rounded-sm border border-border px-2 py-1 disabled:opacity-40"
          >
            Older
          </button>
        </div>
        {hasMore && offset >= MAX_HISTORY_OFFSET && (
          <p
            className={cn(
              'basis-full text-[11px] text-muted-foreground',
              noteClassName,
            )}
          >
            {capMessage}
          </p>
        )}
      </div>
    </>
  );
}
