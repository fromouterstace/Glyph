import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ImportedTag,
  LabelImportPanel,
  importProblem,
  isImported,
} from '../src/components/label-import';

const state = vi.hoisted(() => ({
  connected: undefined as boolean | undefined,
  error: null as { status: number } | null,
  isFetching: false,
  isError: false,
}));
vi.mock('@workspace/api-client-react', () => ({
  getGetLabelImportQueryKey: () => ['label-import'],
  getListContactsQueryKey: () => ['contacts'],
  getSyncLabelImportMutationKey: () => ['sync-label-import'],
  useGetGmailAuthorization: () => ({
    isFetching: state.isFetching,
    isError: state.isError,
    data:
      state.connected === undefined
        ? undefined
        : { connected: state.connected },
  }),
  useGetLabelImport: () => ({
    data: { status: 'synced', lastSyncedAt: null },
    isLoading: false,
    error: null,
  }),
  useSyncLabelImport: () => ({ mutate: vi.fn() }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({
    setQueryData: vi.fn(),
    invalidateQueries: vi.fn(),
  }),
  useIsMutating: () => 0,
  useMutationState: () =>
    state.error ? [{ status: 'error', error: state.error }] : [],
}));
beforeEach(() => {
  state.connected = undefined;
  state.error = null;
  state.isFetching = false;
  state.isError = false;
});

describe('label import UI', () => {
  it('labels imported messages without implying tracking', () => {
    const html = renderToStaticMarkup(<ImportedTag />);
    expect(html).toContain('Imported');
    expect(html).toContain('No historical tracking');
    expect(isImported({ deliverySource: 'import' })).toBe(true);
    expect(isImported({ deliverySource: 'gmail' })).toBe(false);
  });

  it('maps connection and missing-label problems', () => {
    expect(importProblem(undefined, { status: 403 }, false)?.kind).toBe(
      'connection',
    );
    expect(
      importProblem({ status: 'label_missing', lastSyncedAt: null }, null)
        ?.kind,
    ).toBe('label');
    expect(
      importProblem({ status: 'synced', lastSyncedAt: null }, null),
    ).toBeNull();
  });
});

describe('label import connection prompts', () => {
  it('does not ask connected users to connect after an import rejection', () => {
    state.connected = true;
    state.error = { status: 403 };
    const html = renderToStaticMarkup(<LabelImportPanel />);
    expect(html).not.toContain('link-import-connect');
    expect(html).toContain('Gmail import was denied');
  });

  it('shows connection setup only for a confirmed disconnected mailbox', () => {
    state.connected = false;
    expect(renderToStaticMarkup(<LabelImportPanel />)).toContain(
      'link-import-connect',
    );
    state.connected = undefined;
    state.error = { status: 403 };
    expect(renderToStaticMarkup(<LabelImportPanel />)).not.toContain(
      'link-import-connect',
    );
    state.connected = false;
    state.isFetching = true;
    expect(renderToStaticMarkup(<LabelImportPanel />)).not.toContain(
      'link-import-connect',
    );
    state.isFetching = false;
    state.isError = true;
    expect(renderToStaticMarkup(<LabelImportPanel />)).not.toContain(
      'link-import-connect',
    );
  });

  it('distinguishes an expired Glyph session from Gmail connection setup', () => {
    state.connected = false;
    state.error = { status: 401 };
    const html = renderToStaticMarkup(<LabelImportPanel />);
    expect(html).not.toContain('link-import-connect');
    expect(html).toContain('Your Glyph session could not be verified');
  });
});
