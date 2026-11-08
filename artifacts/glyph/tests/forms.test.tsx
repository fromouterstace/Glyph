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
  settingsError: false,
  settingsRefetch: vi.fn(),
  sending: false,
  settings: {
    emailAlerts: false,
    emailAlertStatus: '0 queued',
    defaultTrackOpens: true,
    defaultTrackClicks: false,
    notifyOpens: true,
    notifyClicks: true,
    notifyReplies: true,
    trackingBaseUrl: '',
    readOnly: false,
  },
  userLoaded: true,
  user: {
    id: 'sender-1',
    fullName: 'Authenticated Sender',
    firstName: 'Authenticated',
    lastName: 'Sender',
  } as {
    id: string;
    fullName: string | null;
    firstName: string | null;
    lastName: string | null;
  } | null,
}));

vi.mock('@clerk/react', () => ({
  useUser: () => ({ user: mocks.user, isLoaded: mocks.userLoaded }),
}));
// Lifecycle tests isolate editing events; rich-editor.test.tsx exercises the real editor.
vi.mock('@/components/rich-email-editor', () => ({
  RichEmailEditor: ({
    plainText,
    value,
    onChange,
  }: {
    plainText: string;
    value: string;
    onChange: (html: string, text: string) => void;
  }) => (
    <textarea
      data-testid="input-body"
      data-html={value}
      value={plainText}
      onChange={(event) =>
        onChange(`<p>${event.target.value}</p>`, event.target.value)
      }
    />
  ),
}));
vi.mock('@workspace/api-client-react', () => ({
  useGetConnection: () => ({
    data: { authorized: true, email: 'owner@example.com' },
  }),
  useGetSettings: () => ({
    data: mocks.settings,
    isError: mocks.settingsError,
    refetch: mocks.settingsRefetch,
  }),
  useCreateMessage: () => ({ mutateAsync: mocks.create, isPending: false }),
  useUpdateMessage: () => ({ mutateAsync: mocks.update, isPending: false }),
  useSendMessage: () => ({ mutateAsync: mocks.send, isPending: mocks.sending }),
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
  ReadOnlyTag: () => <span>Read only</span>,
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
  createdAt: '2026-11-05T00:00:00Z',
  sentAt: null,
  lastActivityAt: null,
};
const field = (id: string) => screen.getByTestId(id) as HTMLInputElement;
it('blocks review for mismatched tracking settings without blocking draft saving or losing edits on recovery', () => {
  mocks.settings.trackingBaseUrl = 'https://different.example';
  const view = render(
    <ComposeDialog open onOpenChange={vi.fn()} message={message} />,
  );
  fireEvent.change(field('input-subject'), {
    target: { value: 'Keep my edits' },
  });
  expect(
    (screen.getByTestId('button-review-send') as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(
    (screen.getByTestId('button-save-draft') as HTMLButtonElement).disabled,
  ).toBe(false);
  fireEvent.click(screen.getByTestId('button-review-send'));
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(screen.getByTestId('notice-composer-delivery').textContent).toContain(
    'Clear it in Settings',
  );
  mocks.settings.trackingBaseUrl = '';
  view.rerender(
    <ComposeDialog open onOpenChange={vi.fn()} message={message} />,
  );
  expect(field('input-subject').value).toBe('Keep my edits');
  expect(
    (screen.getByTestId('button-review-send') as HTMLButtonElement).disabled,
  ).toBe(false);
});
it('saves multiple To, Cc and Bcc, preserves roles on reopen and clears removed Bcc', async () => {
  mocks.update.mockResolvedValue(message);
  const grouped = {
    ...message,
    toEmails: ['recipient@example.org', 'second@example.org'],
    ccEmails: ['copy@example.org'],
    bccEmails: ['hidden@example.org'],
  };
  render(<ComposeDialog open onOpenChange={vi.fn()} message={grouped} />);
  expect(field('input-recipient-email').value).toBe(
    grouped.toEmails.join(', '),
  );
  expect(field('input-cc-emails').value).toBe('copy@example.org');
  expect(field('input-bcc-emails').value).toBe('hidden@example.org');
  fireEvent.change(field('input-bcc-emails'), { target: { value: '' } });
  fireEvent.click(screen.getByTestId('button-save-draft'));
  await waitFor(() =>
    expect(mocks.update).toHaveBeenCalledWith({
      id: message.id,
      data: expect.objectContaining({
        toEmails: grouped.toEmails,
        ccEmails: grouped.ccEmails,
        bccEmails: [],
      }),
    }),
  );
  expect(mocks.send).not.toHaveBeenCalled();
});

it('keeps formatted HTML and owned attachment IDs when saving an existing draft', async () => {
  const attachment = {
    id: 'retained-file',
    name: 'report.pdf',
    size: 10,
    contentType: 'application/pdf',
  };
  const rich = {
    ...message,
    bodyHtml: '<p><strong>Original body</strong></p>',
    attachments: [attachment],
  };
  mocks.update.mockResolvedValue(rich);
  render(<ComposeDialog open onOpenChange={vi.fn()} message={rich} />);
  expect(field('input-body').getAttribute('data-html')).toBe(rich.bodyHtml);
  expect(screen.getByText(/report.pdf/)).toBeTruthy();
  fireEvent.change(field('input-subject'), {
    target: { value: 'Updated subject' },
  });
  fireEvent.click(screen.getByTestId('button-save-draft'));
  await waitFor(() =>
    expect(mocks.update).toHaveBeenCalledWith({
      id: message.id,
      data: expect.objectContaining({
        bodyHtml: rich.bodyHtml,
        body: message.body,
        attachmentIds: [attachment.id],
      }),
    }),
  );
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.settingsError = false;
  mocks.sending = false;
  mocks.settings.trackingBaseUrl = '';
  mocks.settings.defaultTrackOpens = true;
  mocks.settings.readOnly = false;
  mocks.settings.emailAlerts = false;
  mocks.userLoaded = true;
  mocks.user = {
    id: 'sender-1',
    fullName: 'Authenticated Sender',
    firstName: 'Authenticated',
    lastName: 'Sender',
  };
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
});

it('failed draft persistence never opens send confirmation or submits to Gmail', async () => {
  mocks.update.mockRejectedValueOnce(new Error('Draft unavailable'));
  render(<ComposeDialog open onOpenChange={vi.fn()} message={message} />);
  fireEvent.click(screen.getByTestId('button-review-send'));
  await screen.findByText('Draft unavailable');
  expect(screen.queryByTestId('button-confirm-send')).toBeNull();
  expect(mocks.send).not.toHaveBeenCalled();
});

it('cancelling confirmation leaves the saved draft unsent and editable', async () => {
  mocks.update.mockResolvedValueOnce(message);
  render(<ComposeDialog open onOpenChange={vi.fn()} message={message} />);
  fireEvent.click(screen.getByTestId('button-review-send'));
  await screen.findByTestId('button-confirm-send');
  fireEvent.click(screen.getByTestId('button-cancel-send'));
  expect(screen.queryByTestId('button-confirm-send')).toBeNull();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(field('input-body').value).toBe(message.body);
});

it('a failed send retains edits and attachments without automatically retrying', async () => {
  const attached = {
    ...message,
    attachments: [
      { id: 'owned', name: 'report.txt', size: 3, contentType: 'text/plain' },
    ],
  };
  mocks.update.mockResolvedValueOnce(attached);
  mocks.send.mockRejectedValueOnce(new Error('Delivery uncertain'));
  const close = vi.fn();
  render(<ComposeDialog open onOpenChange={close} message={attached} />);
  fireEvent.change(field('input-subject'), {
    target: { value: 'Keep this subject' },
  });
  fireEvent.click(screen.getByTestId('button-review-send'));
  fireEvent.click(await screen.findByTestId('button-confirm-send'));
  await screen.findByText('Delivery uncertain');
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(close).not.toHaveBeenCalled();
  expect(field('input-subject').value).toBe('Keep this subject');
  expect(screen.getByText(/report.txt/)).toBeTruthy();
  expect(mocks.invalidate).toHaveBeenCalled();
});

it('settings becoming unavailable revokes an already-open send confirmation', async () => {
  mocks.update.mockResolvedValueOnce(message);
  const props = { open: true, onOpenChange: vi.fn(), message };
  const view = render(<ComposeDialog {...props} />);
  fireEvent.click(screen.getByTestId('button-review-send'));
  await screen.findByTestId('button-confirm-send');
  mocks.settingsError = true;
  view.rerender(<ComposeDialog {...props} />);
  const confirm = screen.getByTestId(
    'button-confirm-send',
  ) as HTMLButtonElement;
  expect(confirm.disabled).toBe(true);
  fireEvent.click(confirm);
  expect(mocks.send).not.toHaveBeenCalled();
});

it('pending delivery blocks duplicate confirmation clicks', async () => {
  mocks.update.mockResolvedValueOnce(message);
  const props = { open: true, onOpenChange: vi.fn(), message };
  const view = render(<ComposeDialog {...props} />);
  fireEvent.click(screen.getByTestId('button-review-send'));
  await screen.findByTestId('button-confirm-send');
  mocks.sending = true;
  view.rerender(<ComposeDialog {...props} />);
  fireEvent.click(screen.getByTestId('button-confirm-send'));
  fireEvent.click(screen.getByTestId('button-confirm-send'));
  expect(mocks.send).not.toHaveBeenCalled();
});

it.each([
  ['duplicate roles', 'recipient@example.org', 'RECIPIENT@example.org'],
  ['invalid address', 'not-an-email', ''],
  ['no recipient', '', ''],
])('blocks saving and sending for %s', (_reason, to, cc) => {
  render(<ComposeDialog open onOpenChange={vi.fn()} message={message} />);
  fireEvent.change(field('input-recipient-email'), { target: { value: to } });
  fireEvent.change(field('input-cc-emails'), { target: { value: cc } });
  expect(
    (screen.getByTestId('button-save-draft') as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(
    (screen.getByTestId('button-review-send') as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(mocks.update).not.toHaveBeenCalled();
  expect(mocks.send).not.toHaveBeenCalled();
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

// This callback organizes focused cases; the 50-line limit applies to each test.
// eslint-disable-next-line max-lines-per-function
describe('composer sessions', () => {
  it('shows the authenticated sender instead of a recipient or fictional example', () => {
    render(<ComposeDialog open onOpenChange={vi.fn()} message={message} />);
    expect(field('input-sender-name').value).toBe('Authenticated Sender');
    expect(field('input-sender-name').readOnly).toBe(true);
    expect(field('input-sender-name').getAttribute('aria-label')).toBe(
      'Sender name',
    );
    expect(screen.queryByTestId('input-recipient-name')).toBeNull();
    expect(
      screen.queryByPlaceholderText(/Maya|harborline|Rotterdam|freight/i),
    ).toBeNull();
  });

  it('uses explicit missing/loading states rather than inventing a sender name', () => {
    mocks.user = {
      id: 'sender-1',
      fullName: null,
      firstName: null,
      lastName: null,
    };
    const view = render(
      <ComposeDialog open onOpenChange={vi.fn()} message={message} />,
    );
    expect(field('input-sender-name').value).toBe('');
    expect(field('input-sender-name').placeholder).toMatch(/No sender name/);
    mocks.userLoaded = false;
    view.rerender(
      <ComposeDialog open onOpenChange={vi.fn()} message={message} />,
    );
    expect(field('input-sender-name').value).toBe('');
    expect(field('input-sender-name').placeholder).toMatch(/Loading/);
  });

  it('uses real profile name parts and never retains a signed-out sender name', () => {
    mocks.user = {
      id: 'sender-1',
      fullName: null,
      firstName: 'Given',
      lastName: 'Family',
    };
    const props = { open: true, onOpenChange: vi.fn() };
    const view = render(<ComposeDialog {...props} />);
    expect(field('input-sender-name').value).toBe('Given Family');
    mocks.user = null;
    view.rerender(<ComposeDialog {...props} />);
    expect(field('input-sender-name').value).toBe('');
  });

  it('updates the profile name without losing edits and resets on account changes', () => {
    const props = { open: true, onOpenChange: vi.fn(), message };
    const view = render(<ComposeDialog {...props} />);
    fireEvent.change(field('input-body'), {
      target: { value: 'Unsaved edit' },
    });
    mocks.user = { ...mocks.user!, fullName: 'Updated Sender' };
    view.rerender(<ComposeDialog {...props} />);
    expect(field('input-sender-name').value).toBe('Updated Sender');
    expect(field('input-body').value).toBe('Unsaved edit');
    mocks.user = { ...mocks.user, id: 'sender-2', fullName: 'Second Sender' };
    view.rerender(<ComposeDialog {...props} />);
    expect(field('input-sender-name').value).toBe('Second Sender');
    expect(field('input-body').value).toBe('Original body');
  });

  it('keeps existing recipient metadata separate from the sender on save', async () => {
    mocks.update.mockResolvedValueOnce(message);
    render(<ComposeDialog open onOpenChange={vi.fn()} message={message} />);
    fireEvent.click(screen.getByTestId('button-save-draft'));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.update).toHaveBeenCalledWith({
      id: message.id,
      data: expect.objectContaining({ recipientName: 'Recipient' }),
    });
    expect(mocks.update.mock.calls[0][0].data).not.toHaveProperty('senderName');
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it('clears a stale recipient name when changing the destination address', async () => {
    mocks.update.mockResolvedValueOnce(message);
    render(<ComposeDialog open onOpenChange={vi.fn()} message={message} />);
    fireEvent.change(field('input-recipient-email'), {
      target: { value: 'different@example.org' },
    });
    fireEvent.click(screen.getByTestId('button-save-draft'));
    await waitFor(() => expect(mocks.update).toHaveBeenCalled());
    expect(mocks.update).toHaveBeenCalledWith({
      id: message.id,
      data: expect.objectContaining({
        recipientEmail: 'different@example.org',
        recipientName: '',
      }),
    });
  });

  it('creates a new draft without sending', async () => {
    mocks.create.mockResolvedValueOnce(message);
    const change = vi.fn();
    render(<ComposeDialog open onOpenChange={change} />);
    expect(field('input-sender-name').value).toBe('Authenticated Sender');
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
        recipientName: '',
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

it('requires saving explicit email consent and never submits the read-only delivery status', () => {
  render(<SettingsPage />);
  const toggle = screen.getByTestId('switch-email-alerts');
  expect(toggle.getAttribute('aria-checked')).toBe('false');
  fireEvent.click(toggle);
  expect(mocks.settingsUpdate).not.toHaveBeenCalled();
  fireEvent.click(screen.getByTestId('button-save-settings'));
  const payload = mocks.settingsUpdate.mock.calls[0][0].data;
  expect(payload.emailAlerts).toBe(true);
  expect(payload.emailAlertStatus).toBeUndefined();
  expect(payload.readOnly).toBeUndefined();
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

  it('keeps signed-out settings read-only', () => {
    mocks.settings.readOnly = true;
    render(<SettingsPage />);
    expect(field('input-tracking-url').disabled).toBe(true);
    expect(
      (screen.getByTestId('button-save-settings') as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });
});
