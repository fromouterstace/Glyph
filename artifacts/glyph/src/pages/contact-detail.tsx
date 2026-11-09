import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'wouter';
import { keepPreviousData } from '@tanstack/react-query';
import { ArrowLeft } from 'lucide-react';
import {
  getGetContactDetailQueryKey,
  useGetContactDetail,
  type ContactDetail,
} from '@workspace/api-client-react';
import { EmptyState, ErrorState } from '@/components/bits';
import {
  ContactFigures,
  ContactHeader,
  EventRow,
  MessageRow,
  OffsetPager,
  SignalCaveat,
} from '@/components/contact-profile';
import { Skeleton } from '@/components/ui/skeleton';
import { errorText, usePoll } from '@/lib/glyph';

function BackLink() {
  return (
    <Link
      href="/contacts"
      data-testid="link-back-contacts"
      className="inline-flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-wider text-muted-foreground hover:text-foreground"
    >
      <ArrowLeft className="size-3.5" /> All contacts
    </Link>
  );
}

function Panel(props: { title: string; count: number; children: ReactNode }) {
  return (
    <section className="border border-border bg-card">
      <h2 className="flex items-baseline justify-between border-b border-border px-4 py-2.5">
        <span className="font-display text-lg font-bold">{props.title}</span>
        <span className="font-mono text-[11px] text-muted-foreground">
          {props.count} total
        </span>
      </h2>
      {props.children}
    </section>
  );
}

function Loading() {
  return (
    <div className="space-y-4" data-testid="state-loading">
      <Skeleton className="h-14 w-72" />
      <Skeleton className="h-24" />
      <Skeleton className="h-64" />
    </div>
  );
}

export function ContactProfileView(props: {
  detail: ContactDetail;
  busy: boolean;
  onMessageOffset: (n: number) => void;
  onEventOffset: (n: number) => void;
}) {
  const { detail: d, busy } = props;
  return (
    <div className="space-y-6">
      <ContactHeader detail={d} />
      <ContactFigures detail={d} />
      <SignalCaveat />
      <div className="grid gap-6 lg:grid-cols-[1.15fr_1fr]">
        <Panel title="Correspondence" count={d.totalMessages}>
          {d.messages.length ? (
            <ul className="divide-y divide-border">
              {d.messages.map((m) => (
                <MessageRow key={m.id} m={m} />
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No correspondence"
              body="Glyph has no stored messages with this contact yet."
            />
          )}
          <OffsetPager
            scope="messages"
            offset={d.messageOffset}
            limit={d.messageLimit}
            total={d.totalMessages}
            shown={d.messages.length}
            busy={busy}
            onOffset={props.onMessageOffset}
          />
        </Panel>
        <Panel title="Recorded signals" count={d.totalEvents}>
          {d.events.length ? (
            <ul className="divide-y divide-border">
              {d.events.map((e) => (
                <EventRow key={e.id} e={e} />
              ))}
            </ul>
          ) : (
            <EmptyState
              title="No signals recorded"
              body="No sends, pixel loads, link requests or replies are stored for this contact's messages."
            />
          )}
          <OffsetPager
            scope="events"
            offset={d.eventOffset}
            limit={d.eventLimit}
            total={d.totalEvents}
            shown={d.events.length}
            busy={busy}
            onOffset={props.onEventOffset}
          />
        </Panel>
      </div>
    </div>
  );
}

export default function ContactDetailPage() {
  const id = useParams<{ id: string }>().id ?? '';
  return <ContactDetailLoader key={id} id={id} />;
}

function ContactDetailLoader({ id }: { id: string }) {
  const poll = usePoll();
  const [offsets, setOffsets] = useState({
    messageOffset: 0,
    eventOffset: 0,
  });
  const params = {
    messageOffset: offsets.messageOffset,
    eventOffset: offsets.eventOffset,
  };
  const q = useGetContactDetail(id, params, {
    query: {
      enabled: !!id,
      refetchInterval: poll,
      queryKey: getGetContactDetailQueryKey(id, params),
      placeholderData: (prev, prevQuery) =>
        prevQuery?.queryKey[0] === getGetContactDetailQueryKey(id)[0]
          ? keepPreviousData(prev)
          : undefined,
    },
  });
  const status = (q.error as { status?: number } | null)?.status;
  let body: ReactNode;
  if (q.isLoading) body = <Loading />;
  else if (status === 404)
    body = (
      <EmptyState
        title="Contact not found"
        body="This contact does not exist in your workspace or was removed."
      />
    );
  else if (q.isError || !q.data)
    body = (
      <ErrorState error={errorText(q.error)} onRetry={() => q.refetch()} />
    );
  else
    body = (
      <ContactProfileView
        detail={q.data}
        busy={q.isFetching}
        onMessageOffset={(n) =>
          setOffsets((prev) => ({ ...prev, messageOffset: n }))
        }
        onEventOffset={(n) =>
          setOffsets((prev) => ({ ...prev, eventOffset: n }))
        }
      />
    );
  return (
    <div className="rise space-y-5">
      <BackLink />
      {body}
    </div>
  );
}
