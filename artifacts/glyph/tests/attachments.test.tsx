import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { EmailAttachments } from '@/components/email-attachments';
import type { Attachment } from '@workspace/api-client-react';

const api = vi.hoisted(() => ({
  request: vi.fn(),
  complete: vi.fn(),
  remove: vi.fn(),
  download: vi.fn(),
  error: vi.fn(),
  busy: vi.fn(),
}));
vi.mock('@workspace/api-client-react', () => ({
  requestAttachmentUpload: (...args: unknown[]) => api.request(...args),
  completeAttachmentUpload: (...args: unknown[]) => api.complete(...args),
  deleteAttachment: (...args: unknown[]) => api.remove(...args),
  downloadAttachment: (...args: unknown[]) => api.download(...args),
}));
vi.mock('@/lib/glyph', () => ({ errorText: (error: Error) => error.message }));
const file = {
  id: 'owned-file',
  name: 'report.txt',
  size: 5,
  contentType: 'text/plain',
};
function Picker({ initial = [] }: { initial?: Attachment[] }) {
  const [files, setFiles] = useState(initial);
  return (
    <EmailAttachments
      files={files}
      onChange={setFiles}
      onBusy={api.busy}
      onError={api.error}
    />
  );
}
const select = (files: File[]) =>
  fireEvent.change(screen.getByTestId('input-attachments'), {
    target: { files },
  });
beforeEach(() => {
  vi.clearAllMocks();
  api.request.mockResolvedValue({
    attachment: file,
    uploadUrl: 'https://storage.googleapis.com/private-fixture/upload',
  });
  api.complete.mockResolvedValue(file);
  api.remove.mockResolvedValue(undefined);
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true }));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
it('uploads bytes directly without cookies and only adds a server-verified file', async () => {
  render(<Picker />);
  select([new File(['hello'], 'report.txt', { type: 'text/plain' })]);
  await screen.findByTestId('attachment-row');
  expect(api.request).toHaveBeenCalledWith(
    { name: 'report.txt', size: 5, contentType: 'text/plain' },
    expect.anything(),
  );
  expect(fetch).toHaveBeenCalledWith(
    expect.any(URL),
    expect.objectContaining({
      method: 'PUT',
      credentials: 'omit',
      body: expect.any(File),
    }),
  );
  expect(api.complete).toHaveBeenCalledWith(file.id, expect.anything());
  expect(api.busy.mock.calls).toEqual([[true], [false]]);
  fireEvent.click(screen.getByLabelText('Remove report.txt'));
  expect(screen.queryByTestId('attachment-row')).toBeNull();
});
it('preserves saved attachments and reports failed uploads without adding a fake file', async () => {
  api.request.mockRejectedValue(new Error('Upload unavailable'));
  render(<Picker initial={[file]} />);
  select([new File(['hello'], 'another.txt')]);
  await waitFor(() =>
    expect(api.error).toHaveBeenCalledWith('Upload unavailable'),
  );
  expect(screen.getAllByTestId('attachment-row')).toHaveLength(1);
  expect(api.complete).not.toHaveBeenCalled();
});
it('rejects invalid budgets before requesting an upload', () => {
  render(<Picker />);
  select([new File([], 'empty.txt')]);
  expect(api.error).toHaveBeenLastCalledWith(
    expect.stringContaining('10 files'),
  );
  expect(api.request).not.toHaveBeenCalled();
});
it('does not send file bytes to an untrusted upload destination', async () => {
  api.request.mockResolvedValue({
    attachment: file,
    uploadUrl: 'https://attacker.invalid/upload',
  });
  render(<Picker />);
  select([new File(['hello'], 'report.txt')]);
  await waitFor(() =>
    expect(api.error).toHaveBeenCalledWith(
      'The upload destination is not trusted.',
    ),
  );
  expect(fetch).not.toHaveBeenCalled();
  expect(screen.queryByTestId('attachment-row')).toBeNull();
});

it('a rejected byte upload never finalizes or replaces a saved attachment', async () => {
  vi.mocked(fetch).mockResolvedValue({ ok: false } as Response);
  render(<Picker initial={[file]} />);
  select([new File(['hello'], 'another.txt')]);
  await waitFor(() =>
    expect(api.error).toHaveBeenCalledWith(
      'The file upload failed. Please try again.',
    ),
  );
  expect(api.complete).not.toHaveBeenCalled();
  expect(screen.getAllByTestId('attachment-row')).toHaveLength(1);
  expect(api.busy).toHaveBeenLastCalledWith(false);
});

it('failed server verification never adds an unverified attachment', async () => {
  api.complete.mockRejectedValueOnce(new Error('File verification failed'));
  render(<Picker />);
  select([new File(['hello'], 'report.txt')]);
  await waitFor(() =>
    expect(api.error).toHaveBeenCalledWith('File verification failed'),
  );
  expect(screen.queryByTestId('attachment-row')).toBeNull();
  expect(api.remove).toHaveBeenCalledWith(file.id);
  expect(api.busy).toHaveBeenLastCalledWith(false);
});
