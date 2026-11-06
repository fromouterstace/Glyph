export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;
export class ComposerError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ComposerError';
  }
}
export function validateAttachmentInput(input: {
  name: string;
  size: number;
  contentType: string;
}) {
  if (
    !input.name.trim() ||
    /[/\\]/.test(input.name) ||
    [...input.name].some(
      (c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127,
    ) ||
    Buffer.byteLength(input.name, 'utf8') > 180 ||
    !Number.isInteger(input.size) ||
    input.size < 1 ||
    input.size > MAX_ATTACHMENT_BYTES ||
    !/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(input.contentType)
  )
    throw new ComposerError(
      400,
      'Choose a valid file up to 10 MiB with a safe filename.',
    );
}
export function validateAttachmentTotal(files: { id: string; size: number }[]) {
  if (
    files.length > MAX_ATTACHMENTS ||
    new Set(files.map((f) => f.id)).size !== files.length ||
    files.some((f) => f.size < 1 || f.size > MAX_ATTACHMENT_BYTES) ||
    files.reduce((sum, f) => sum + f.size, 0) > MAX_TOTAL_ATTACHMENT_BYTES
  )
    throw new ComposerError(
      400,
      'Attach up to 10 files, 10 MiB each and 15 MiB combined.',
    );
}
