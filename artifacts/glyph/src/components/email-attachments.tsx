import { useEffect, useRef, useState } from 'react';
import { Paperclip, X, Download } from 'lucide-react';
import {
  requestAttachmentUpload,
  completeAttachmentUpload,
  downloadAttachment,
  deleteAttachment,
  type Attachment,
} from '@workspace/api-client-react';
import { errorText } from '@/lib/glyph';

type Props = {
  files: Attachment[];
  onChange: (files: Attachment[]) => void;
  onBusy: (busy: boolean) => void;
  onError: (message: string | null) => void;
  disabled?: boolean;
};
export async function releaseUnusedAttachment(id: string) {
  try {
    await deleteAttachment(id);
    return true;
  } catch (error) {
    const status =
      error && typeof error === 'object' && 'status' in error
        ? error.status
        : null;
    if (status === 404 || status === 409) return true;
    console.warn(
      'Unused attachment cleanup could not finish; the file remains private.',
    );
    return false;
  }
}
export function AttachmentDownloads({ files = [] }: { files?: Attachment[] }) {
  const [error, setError] = useState<string | null>(null);
  if (!files.length) return null;
  return (
    <section className="mt-6" aria-label="Message attachments">
      <h3 className="mb-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground">
        Attachments
      </h3>
      <ul className="space-y-2">
        {files.map((file) => (
          <li key={file.id}>
            <button
              type="button"
              className="flex items-center gap-2 text-xs underline underline-offset-2"
              onClick={() =>
                void download(file).catch((e) => setError(errorText(e)))
              }
            >
              <Download className="size-3.5" />
              {file.name} · {(file.size / 1024).toFixed(1)} KiB
            </button>
          </li>
        ))}
      </ul>
      {error && (
        <p role="alert" className="mt-2 text-xs text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
function checkFiles(files: { size: number }[]) {
  if (
    files.length > 10 ||
    files.some((f) => f.size < 1 || f.size > 10 * 1024 * 1024) ||
    files.reduce((sum, f) => sum + f.size, 0) > 15 * 1024 * 1024
  )
    throw new Error('Attach up to 10 files, 10 MiB each and 15 MiB combined.');
}
async function download(file: Attachment) {
  const blob = await downloadAttachment(file.id);
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function EmailAttachments({
  files,
  onChange,
  onBusy,
  onError,
  disabled,
}: Props) {
  const picker = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const active = useRef(true);
  const controller = useRef<AbortController | null>(null);
  const created = useRef<string[]>([]);
  useEffect(() => {
    active.current = true;
    const createdUploads = created.current;
    return () => {
      active.current = false;
      controller.current?.abort();
      void (async () => {
        for (const id of createdUploads) await releaseUnusedAttachment(id);
      })();
    };
  }, []);
  async function upload(selected: File[]) {
    onError(null);
    try {
      checkFiles([...files, ...selected]);
    } catch (error) {
      onError(errorText(error));
      return;
    }
    setUploading(true);
    onBusy(true);
    const signal = (controller.current = new AbortController()).signal;
    const completed = [...files];
    let pendingId: string | null = null;
    try {
      for (const file of selected) {
        const pending = await requestAttachmentUpload(
          {
            name: file.name,
            size: file.size,
            contentType: file.type || 'application/octet-stream',
          },
          { signal },
        );
        const url = new URL(pending.uploadUrl);
        created.current.push(pending.attachment.id);
        pendingId = pending.attachment.id;
        if (!active.current) {
          await releaseUnusedAttachment(pending.attachment.id);
          return;
        }
        if (
          url.protocol !== 'https:' ||
          url.hostname !== 'storage.googleapis.com'
        )
          throw new Error('The upload destination is not trusted.');
        const response = await fetch(url, {
          method: 'PUT',
          body: file,
          credentials: 'omit',
          signal,
          headers: { 'Content-Type': file.type || 'application/octet-stream' },
        });
        if (!response.ok)
          throw new Error('The file upload failed. Please try again.');
        const ready = await completeAttachmentUpload(pending.attachment.id, {
          signal,
        });
        if (!active.current) return;
        completed.push(ready);
        onChange([...completed]);
        pendingId = null;
      }
    } catch (error) {
      if (pendingId) await releaseUnusedAttachment(pendingId);
      if (active.current) onError(errorText(error));
    } finally {
      if (active.current) {
        setUploading(false);
        onBusy(false);
      }
    }
  }
  return (
    <section
      className="border-t border-border px-5 py-3"
      aria-label="Email attachments"
    >
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="button-add-attachment"
          disabled={disabled || uploading}
          onClick={() => picker.current?.click()}
          className="flex items-center gap-1.5 text-xs disabled:opacity-50"
        >
          <Paperclip className="size-3.5" />
          {uploading ? 'Uploading…' : 'Attach files'}
        </button>
        <span className="text-[10px] text-muted-foreground">
          10 MiB per file · 15 MiB total · up to 10 files
        </span>
      </div>
      <input
        ref={picker}
        data-testid="input-attachments"
        type="file"
        multiple
        className="sr-only"
        disabled={disabled || uploading}
        onChange={(e) => {
          const selected = Array.from(e.target.files ?? []);
          e.target.value = '';
          if (selected.length) void upload(selected);
        }}
      />
      <ul className="mt-2 space-y-1">
        {files.map((file) => (
          <li
            key={file.id}
            className="flex items-center gap-2 text-xs"
            data-testid="attachment-row"
          >
            <span className="min-w-0 flex-1 truncate">
              {file.name} · {(file.size / 1024).toFixed(1)} KiB
            </span>
            <button
              type="button"
              aria-label={`Download ${file.name}`}
              onClick={() =>
                void download(file).catch((e) => onError(errorText(e)))
              }
            >
              <Download className="size-3.5" />
            </button>
            <button
              type="button"
              disabled={disabled || uploading}
              aria-label={`Remove ${file.name}`}
              onClick={() => onChange(files.filter((f) => f.id !== file.id))}
            >
              <X className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
