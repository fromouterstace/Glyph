import { useEffect, useRef, useState } from 'react';
import { keepPreviousData } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import {
  getListContactsQueryKey,
  useListContacts,
  type ListContactsParams,
} from '@workspace/api-client-react';
import { Avatar, EmptyState, ErrorState, SectionHead } from '@/components/bits';
import { LabelImportPanel } from '@/components/label-import';
import { errorText, stamp } from '@/lib/glyph';

const PAGE = 50;

export default function ContactsPage() {
  const [input, setInput] = useState('');
  const [search, setSearch] = useState('');
  const [offset, setOffset] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);
  const onSearch = (v: string) => {
    setInput(v);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      setSearch(v.trim().slice(0, 200));
      setOffset(0);
    }, 300);
  };

  const params: ListContactsParams = search ? { offset, search } : { offset };
  const q = useListContacts(params, {
    query: {
      queryKey: getListContactsQueryKey(params),
      placeholderData: keepPreviousData,
    },
  });
  const data = q.data;
  const total = data?.total ?? 0;
  const limit = data?.limit || PAGE;

  return (
    <div className="rise space-y-6">
      <SectionHead
        kicker="Imported from your Gmail label"
        title="Contacts"
        right={
          <span
            className="font-mono text-xs text-muted-foreground"
            data-testid="text-contacts-total"
          >
            {data ? `${total} total` : ''}
          </span>
        }
      />
      <LabelImportPanel />

      <div className="border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2.5">
          <Search className="size-4 text-muted-foreground" />
          <input
            type="search"
            value={input}
            maxLength={200}
            onChange={(e) => onSearch(e.target.value)}
            placeholder="Search name, email, or domain"
            data-testid="input-contact-search"
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {q.isFetching && !q.isLoading && (
            <span className="font-mono text-[10px] uppercase text-muted-foreground">
              loading
            </span>
          )}
        </div>

        {q.isLoading ? (
          <ul className="divide-y divide-border" data-testid="state-loading">
            {Array.from({ length: 8 }).map((_, i) => (
              <li key={i} className="flex items-center gap-3 px-4 py-3">
                <span className="size-8 animate-pulse rounded-sm bg-muted" />
                <span className="h-3 w-40 animate-pulse rounded-sm bg-muted" />
                <span className="ml-auto h-3 w-24 animate-pulse rounded-sm bg-muted" />
              </li>
            ))}
          </ul>
        ) : q.isError || !data ? (
          <div className="p-5">
            <ErrorState
              error={errorText(q.error)}
              onRetry={() => q.refetch()}
            />
          </div>
        ) : !data.contacts.length ? (
          <EmptyState
            title={search ? 'No matches' : 'No contacts yet'}
            body={
              search
                ? `Nothing matches "${search}". Try a shorter name or a domain.`
                : 'Contacts appear here after Glyph imports messages from your Gmail label.'
            }
            action={
              search ? (
                <button
                  data-testid="button-clear-search"
                  onClick={() => onSearch('')}
                  className="rounded-sm border border-border px-3 py-1.5 text-xs font-medium"
                >
                  Clear search
                </button>
              ) : undefined
            }
          />
        ) : (
          <>
            <div className="hidden grid-cols-[1.4fr_1.6fr_1fr_0.8fr] gap-4 border-b border-border px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground md:grid">
              <span>Name</span>
              <span>Email</span>
              <span>Domain</span>
              <span className="text-right">Added</span>
            </div>
            <ul className="divide-y divide-border">
              {data.contacts.map((c) => {
                const name = `${c.firstName} ${c.lastName}`.trim();
                return (
                  <li
                    key={c.id}
                    data-testid={`row-contact-${c.id}`}
                    className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-0.5 px-4 py-3 md:grid-cols-[1.4fr_1.6fr_1fr_0.8fr] md:gap-4"
                  >
                    <div className="row-span-2 flex min-w-0 items-center gap-3 md:row-span-1">
                      <Avatar name={name} email={c.email} />
                      <span className="hidden truncate text-sm font-medium md:inline">
                        {name || '—'}
                      </span>
                    </div>
                    <span className="truncate text-sm font-medium md:hidden">
                      {name || c.email}
                    </span>
                    <span className="truncate text-xs text-muted-foreground md:text-sm md:text-foreground/80">
                      {c.email}
                    </span>
                    <span className="hidden font-mono text-xs text-muted-foreground md:inline">
                      {c.emailSuffix}
                    </span>
                    <span className="hidden text-right font-mono text-[11px] text-muted-foreground md:inline">
                      {stamp(c.createdAt)}
                    </span>
                  </li>
                );
              })}
            </ul>
          </>
        )}

        {data && total > 0 && (
          <Pager
            offset={offset}
            limit={limit}
            total={total}
            shown={data.contacts.length}
            busy={q.isFetching}
            onOffset={setOffset}
          />
        )}
      </div>
    </div>
  );
}

function Pager({
  offset,
  limit,
  total,
  shown,
  busy,
  onOffset,
}: {
  offset: number;
  limit: number;
  total: number;
  shown: number;
  busy: boolean;
  onOffset: (n: number) => void;
}) {
  return (
    <div className="flex items-center justify-between border-t border-border px-4 py-2.5 font-mono text-[11px] text-muted-foreground">
      <span data-testid="text-contacts-range">
        {offset + 1}-{Math.min(offset + shown, total)} of {total}
      </span>
      <div className="flex gap-1">
        <button
          data-testid="button-contacts-prev"
          disabled={offset === 0 || busy}
          onClick={() => onOffset(Math.max(0, offset - limit))}
          aria-label="Previous page"
          className="rounded-sm border border-border p-1.5 hover:border-foreground/40 disabled:opacity-40"
        >
          <ChevronLeft className="size-3.5" />
        </button>
        <button
          data-testid="button-contacts-next"
          disabled={offset + limit >= total || busy}
          onClick={() => onOffset(offset + limit)}
          aria-label="Next page"
          className="rounded-sm border border-border p-1.5 hover:border-foreground/40 disabled:opacity-40"
        >
          <ChevronRight className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
