import { PUBLISHED_GLYPH_ORIGIN } from '@/lib/tracking-origin';
import type { composerDeliveryIssue } from '@/lib/composer-delivery';

export function ComposerDeliveryWarning({
  issue,
}: {
  issue: ReturnType<typeof composerDeliveryIssue>;
}) {
  return issue ? <p role="status">{issue.message}</p> : null;
}

export function ComposerDeliveryNotice({
  issue,
  recheck,
}: {
  issue: ReturnType<typeof composerDeliveryIssue>;
  recheck: () => void;
}) {
  if (!issue) return null;
  return (
    <div
      role="note"
      data-testid="notice-composer-delivery"
      className="space-y-2 border-b border-primary/30 bg-primary/[0.06] px-5 py-3 text-xs"
    >
      <p>{issue.message}</p>
      {issue.kind === 'preview' ? (
        <>
          <a
            href={`${PUBLISHED_GLYPH_ORIGIN}/emails`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block font-semibold text-primary underline underline-offset-4"
          >
            Open published Glyph web composer
          </a>
          <p className="text-muted-foreground">
            Drafts and attachments saved here stay in development and do not
            transfer automatically. Keep this tab open while you recreate the
            draft in published Glyph.
          </p>
        </>
      ) : (
        <div className="flex flex-wrap gap-4">
          <a
            href={`${import.meta.env.BASE_URL}settings`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-semibold text-primary underline underline-offset-4"
          >
            Open Settings
          </a>
          <button
            type="button"
            onClick={recheck}
            className="font-semibold text-primary underline underline-offset-4"
          >
            Recheck settings
          </button>
        </div>
      )}
    </div>
  );
}
