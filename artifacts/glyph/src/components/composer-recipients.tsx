import { Fragment } from 'react';
import { Input } from './ui/input';
import {
  splitEmails,
  recipientError,
  type RecipientText,
} from '@/lib/composer-recipients';

const groups = [
  { key: 'to', label: 'To', id: 'input-recipient-email' },
  { key: 'cc', label: 'Cc', id: 'input-cc-emails' },
  { key: 'bcc', label: 'Bcc', id: 'input-bcc-emails' },
] as const;
export function ComposerRecipients({
  value,
  onChange,
}: {
  value: RecipientText;
  onChange: (value: RecipientText) => void;
}) {
  const error = recipientError(value);
  const edited = Object.values(value).some((text) => text.trim());
  return (
    <div className="divide-y divide-border">
      {groups.map((group) => (
        <label key={group.key} className="flex items-center gap-3 px-5 py-2">
          <span className="w-12 shrink-0 font-mono text-[10px] uppercase text-muted-foreground">
            {group.label}
          </span>
          <Input
            type="text"
            aria-label={`${group.label} email addresses`}
            data-testid={group.id}
            value={value[group.key]}
            onChange={(e) =>
              onChange({ ...value, [group.key]: e.target.value })
            }
            placeholder={
              group.key === 'to'
                ? 'Email addresses, separated by commas'
                : `${group.label} addresses (optional)`
            }
            maxLength={25600}
            autoComplete="off"
            className="border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
        </label>
      ))}
      {edited && error && (
        <p role="alert" className="px-5 py-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
export function RecipientReview({ value }: { value: RecipientText }) {
  return (
    <>
      {groups.map((group) => {
        const emails = splitEmails(value[group.key]);
        if (group.key !== 'to' && !emails.length) return null;
        return (
          <Fragment key={group.key}>
            <span className="text-muted-foreground">
              {group.label.toUpperCase()}
            </span>
            <span
              data-testid={
                group.key === 'to'
                  ? 'text-confirm-recipient'
                  : `text-confirm-${group.key}`
              }
              className="break-all"
            >
              {emails.join(', ') || 'Undisclosed recipients'}
            </span>
          </Fragment>
        );
      })}
    </>
  );
}
