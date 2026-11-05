import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { ComposeDialog } from '@/components/compose-dialog';
import SettingsPage from '@/pages/settings';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  update: vi.fn(),
  send: vi.fn(),
  settingsUpdate: vi.fn(),
  toast: vi.fn(),
  invalidate: vi.fn(),
  settings: {
    defaultTrackOpens: true,
    defaultTrackClicks: false,
    notifyOpens: true,
    notifyClicks: true,
    notifyReplies: true,
    trackingBaseUrl: '',
    isDemo: false,
  },
}));

vi.mock('@workspace/api-client-react', () => ({
  useGetSettings: () => ({ data: mocks.settings, isError: false }),
  useCreateMessage: () => ({ mutateAsync: mocks.create, isPending: false }),
  useUpdateMessage: () => ({ mutateAsync: mocks.update, isPending: false }),
  useSendMessage: () => ({ mutateAsync: mocks.send, isPending: false }),
  useUpdateSettings: () => ({ mutate: mocks.settingsUpdate, isPending: false }),
}));
vi.mock('@/lib/glyph', () => ({
  useInvalidateAll: () => mocks.invalidate,
  useSession: () => ({ isSignedIn: true }),
  errorText: (error: unknown) =>
    error instanceof Error ? error.message : String(error),
}));
vi.mock('@/hooks/use-toast', () => ({
  useToast: () => ({ toast: mocks.toast }),
}));
vi.mock('@/components/bits', () => ({
  Caveat: ({ children }: { children: ReactNode }) => <aside>{children}</aside>,
  DemoTag: () => <span>Sample</span>,
  SectionHead: () => <header>Settings</header>,
  SignInNudge: () => null,
  ErrorState: () => <div>Error</div>,
}));
vi.mock('@/components/gmail-connection', () => ({
  GmailConnection: () => <div>Connection</div>,
}));

const message = {
  id: 'first',
  subject: 'Original',
  body: 'Original body',
  recipientEmail: 'recipient@example.org',
  recipientName: 'Recipient',
  status: 'draft' as const,
  trackOpens: false,
  trackClicks: true,
  opens: 0,
  clicks: 0,
  replies: 0,
  starred: false,
  createdAt: '2026-11-05T00:00:00Z',
  sentAt: null,
  lastActivityAt: null,
  isDemo: false,
};
const field = (id: string) => screen.getByTestId(id) as HTMLInputElement;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settings.trackingBaseUrl = '';
  mocks.settings.defaultTrackOpens = true;
  mocks.settings.isDemo = false;
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('composer sessions', () => {
  it('creates a new draft without sending', async () => {
    mocks.create.mockResolvedValueOnce(message);
    const change = vi.fn();
    render(<ComposeDialog open onOpenChange={change} />);
    fireEvent.change(field('input-recipient-email'), {
      target: { value: 'recipient@example.org' },
    });
    fireEvent.change(field('input-subject'), {
      target: { value: 'New subject' },
    });
    fireEvent.change(field('input-body'), { target: { value: 'New body' } });
    fireEvent.click(screen.getByTestId('button-save-draft'));
    await waitFor(() => expect(change).toHaveBeenCalledWith(false));
    expect(mocks.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        subject: 'New subject',
        body: 'New body',
      }),
    });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('preserves the form when a save is rejected', async () => {
    mocks.update.mockRejectedValueOnce(new Error('Save rejected'));
    const change = vi.fn();
    render(<ComposeDialog open onOpenChange={change} message={message} />);
    fireEvent.change(field('input-body'), {
      target: { value: 'Keep this edit' },
    });
    fireEvent.click(screen.getByTestId('button-save-draft'));
    await screen.findByText('Save rejected');
    expect(field('input-body').value).toBe('Keep this edit');
    expect(change).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('only sends after explicit confirmation of the saved draft', async () => {
    mocks.update.mockResolvedValueOnce(message);
    mocks.send.mockResolvedValueOnce({ ...message, status: 'sent' });
    render(<ComposeDialog open onOpenChange={vi.fn()} message={message} />);
    fireEvent.click(screen.getByTestId('button-review-send'));
    await screen.findByTestId('button-confirm-send');
    expect(mocks.send).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('button-confirm-send'));
    await waitFor(() =>
      expect(mocks.send).toHaveBeenCalledWith({ id: 'first' }),
    );
  });

  it('discards an old send confirmation when message identity changes', async () => {
    mocks.update.mockResolvedValueOnce(message);
    const change = vi.fn();
    const view = render(
      <ComposeDialog open onOpenChange={change} message={message} />,
    );
    fireEvent.click(screen.getByTestId('button-review-send'));
    await screen.findByTestId('button-confirm-send');
    view.rerender(
      <ComposeDialog
        open
        onOpenChange={change}
        message={{ ...message, id: 'second', subject: 'Second' }}
      />,
    );
    expect(screen.queryByTestId('button-confirm-send')).toBeNull();
    expect(field('input-subject').value).toBe('Second');
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('preserves local edits when the same message is refreshed', () => {
    const change = vi.fn();
    const view = render(
      <ComposeDialog open onOpenChange={change} message={message} />,
    );
    fireEvent.change(field('input-subject'), {
      target: { value: 'Unsaved edit' },
    });
    view.rerender(
      <ComposeDialog
        open
        onOpenChange={change}
        message={{ ...message, subject: 'Server refresh' }}
      />,
    );
    expect(field('input-subject').value).toBe('Unsaved edit');
  });

  it('resets fields when the selected message changes', () => {
    const change = vi.fn();
    const view = render(
      <ComposeDialog open onOpenChange={change} message={message} />,
    );
    fireEvent.change(field('input-body'), { target: { value: 'Local body' } });
    view.rerender(
      <ComposeDialog
        open
        onOpenChange={change}
        message={{ ...message, id: 'second', body: 'Second body' }}
      />,
    );
    expect(field('input-body').value).toBe('Second body');
  });

  it('starts a fresh form after closing and reopening', () => {
    const change = vi.fn();
    const view = render(<ComposeDialog open onOpenChange={change} />);
    fireEvent.change(field('input-subject'), {
      target: { value: 'Abandoned edit' },
    });
    view.rerender(<ComposeDialog open={false} onOpenChange={change} />);
    view.rerender(<ComposeDialog open onOpenChange={change} />);
    expect(field('input-subject').value).toBe('');
    expect(
      screen.getByTestId('switch-track-opens').getAttribute('aria-checked'),
    ).toBe('true');
    expect(
      screen.getByTestId('switch-track-clicks').getAttribute('aria-checked'),
    ).toBe('false');
  });

  it('saves an edit to its existing draft without sending', async () => {
    mocks.update.mockResolvedValueOnce(message);
    const change = vi.fn();
    render(<ComposeDialog open onOpenChange={change} message={message} />);
    fireEvent.change(field('input-subject'), {
      target: { value: 'Edited subject' },
    });
    fireEvent.click(screen.getByTestId('button-save-draft'));
    await waitFor(() => expect(change).toHaveBeenCalledWith(false));
    expect(mocks.update).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'first',
        data: expect.objectContaining({ subject: 'Edited subject' }),
      }),
    );
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe('settings editing', () => {
  it('preserves pending changes across server refreshes', () => {
    const view = render(<SettingsPage />);
    fireEvent.change(field('input-tracking-url'), {
      target: { value: 'https://local.example' },
    });
    mocks.settings.trackingBaseUrl = 'https://server.example';
    view.rerender(<SettingsPage />);
    expect(field('input-tracking-url').value).toBe('https://local.example');
  });

  it('blocks invalid origins before save and submits valid settings', () => {
    render(<SettingsPage />);
    fireEvent.change(field('input-tracking-url'), {
      target: { value: 'https://glyph.example/path' },
    });
    expect(
      (screen.getByTestId('button-save-settings') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    fireEvent.change(field('input-tracking-url'), {
      target: { value: 'https://glyph.example/' },
    });
    fireEvent.click(screen.getByTestId('button-save-settings'));
    expect(mocks.settingsUpdate).toHaveBeenCalledWith(
      {
        data: expect.objectContaining({
          trackingBaseUrl: 'https://glyph.example',
          notifyReplies: true,
        }),
      },
      expect.any(Object),
    );
  });

  it('keeps sample settings read-only', () => {
    mocks.settings.isDemo = true;
    render(<SettingsPage />);
    expect(field('input-tracking-url').disabled).toBe(true);
    expect(
      (screen.getByTestId('button-save-settings') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
