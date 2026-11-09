import type { PixelDiagnostics as Diagnostics } from '@workspace/api-client-react';

const labels = {
  recorded: 'Recorded',
  sender_compose_ignored: 'Sender-compose ignored',
  tracking_disabled: 'Tracking disabled',
  send_not_confirmed: 'Send unconfirmed',
  unknown_token: 'Unknown token',
  event_budget_exceeded: 'Pixel event budget exceeded',
  native_reconciliation_budget_exceeded: 'Send verification budget exceeded',
  native_reconciliation_failed: 'Send verification unavailable',
};

export function PixelDiagnostics({ data }: { data: Diagnostics }) {
  return (
    <section
      className="border-b border-border p-5 text-xs md:p-6"
      aria-label="Pixel request diagnostics"
    >
      <h3 className="mb-3 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Pixel request diagnostics
      </h3>
      <p className="mb-1 text-muted-foreground">Prepared tracking origin</p>
      <p
        className="mb-3 break-all font-mono"
        data-testid="prepared-tracking-origin"
      >
        {data.preparedTrackingOrigin ?? 'Not recorded'}
      </p>
      <dl className="space-y-2">
        {data.pixelOutcomes.map(({ outcome, requests }) => (
          <div key={outcome} className="flex justify-between gap-3">
            <dt>{labels[outcome]}</dt>
            <dd className="shrink-0 font-mono tabular-nums">
              {requests ?? 'Unattributed'}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-muted-foreground">
        These are diagnostic request outcomes, not additional pixel loads or
        verified reads. Only requests received since diagnostics began appear
        here; no historical loads have been reconstructed.
      </p>
      <p className="mt-2 text-muted-foreground">
        Diagnostics are best-effort and sampled under load. These counts are
        lower bounds, not a complete request history. Pixel-load digits still
        count committed events independently.
      </p>
      <p className="mt-2 text-muted-foreground">
        Unknown tokens are counted without tokens or account attribution and
        cannot be assigned to this message. HEAD checks are excluded. Cached or
        blocked images, requests to another origin, and storage failures may
        leave no diagnostic here.
      </p>
    </section>
  );
}
