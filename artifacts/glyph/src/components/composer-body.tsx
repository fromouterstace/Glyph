import type { MessageInput } from '@workspace/api-client-react';
import { RichEmailEditor } from './rich-email-editor';

export function messageTooLong(form: MessageInput) {
  return form.body.length > 50000 || (form.bodyHtml?.length ?? 0) > 50000;
}
export function ComposerBody({
  form,
  onChange,
  disabled,
}: {
  form: MessageInput;
  onChange: (html: string, text: string) => void;
  disabled: boolean;
}) {
  return (
    <>
      <RichEmailEditor
        value={form.bodyHtml ?? ''}
        plainText={form.body}
        onChange={onChange}
        disabled={disabled}
        placeholder="Write your message"
      />
      {messageTooLong(form) && (
        <p role="alert" className="px-5 py-2 text-xs text-destructive">
          The message is too long. Keep both text and formatting within 50,000
          characters.
        </p>
      )}
    </>
  );
}
