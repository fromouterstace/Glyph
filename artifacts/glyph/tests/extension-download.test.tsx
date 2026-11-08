import { afterEach, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ExtensionDownload } from '../src/components/extension-download';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it('downloads a fetched ZIP as a blob without navigating Preview', async () => {
  const fetcher = vi.fn().mockResolvedValue({
    ok: true,
    blob: async () => new Blob(['PK'], { type: 'application/zip' }),
  });
  vi.stubGlobal('fetch', fetcher);
  const create = vi
    .fn()
    .mockReturnValue('blob:https://glyph.example/extension');
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: vi.fn() });
  const click = vi
    .spyOn(HTMLAnchorElement.prototype, 'click')
    .mockImplementation(() => {});
  render(<ExtensionDownload />);
  fireEvent.click(screen.getByRole('button', { name: 'Download extension' }));
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  expect(fetcher.mock.calls[0][0]).toBe('/glyph-extension.zip');
  const clicked = click.mock.instances[0] as HTMLAnchorElement;
  expect(clicked.download).toBe('glyph-extension.zip');
  expect(clicked.href).toBe('blob:https://glyph.example/extension');
  expect(clicked.isConnected).toBe(false);
  expect(window.location.href).toBe('https://glyph.example/');
});

it.each(['network', 'html', 'status'])(
  'reports a %s failure instead of navigating away',
  async (failure) => {
    vi.stubGlobal(
      'fetch',
      failure === 'network'
        ? vi.fn().mockRejectedValue(new Error('offline'))
        : vi.fn().mockResolvedValue({
            ok: failure !== 'status',
            blob: async () => new Blob(['<html>'], { type: 'text/html' }),
          }),
    );
    render(<ExtensionDownload />);
    fireEvent.click(screen.getByRole('button', { name: 'Download extension' }));
    expect((await screen.findByRole('alert')).textContent).toContain(
      'Could not download the extension',
    );
    expect((screen.getByRole('button') as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(window.location.href).toBe('https://glyph.example/');
  },
);
