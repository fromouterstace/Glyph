import { vi } from 'vitest';

vi.mock('@clerk/react', () => ({
  useAuth: () => ({ isLoaded: true, userId: 'user_a' }),
}));
vi.mock('@workspace/api-client-react', async () => {
  const { hooks } = await import('./database-approvals-mocks');
  return {
    getGetDatabaseApprovalAccessQueryKey: () => [
      '/api/glyph/database-approvals/access',
    ],
    getListDatabaseApprovalsQueryKey: (p?: unknown) => [
      '/api/glyph/database-approvals',
      ...(p ? [p] : []),
    ],
    useGetDatabaseApprovalAccess: (o: unknown) => {
      hooks.options.push(o);
      return hooks.access;
    },
    useListDatabaseApprovals: (_p: unknown, o: unknown) => {
      hooks.options.push(o);
      return hooks.list;
    },
    useCreateDatabaseApproval: (o: unknown) => {
      hooks.options.push(o);
      return { mutate: hooks.create, isPending: hooks.pending };
    },
    useActOnDatabaseApproval: (o: unknown) => {
      hooks.options.push(o);
      return { mutate: hooks.act, isPending: hooks.pending };
    },
  };
});
vi.mock('@/lib/glyph', () => ({
  errorText: (e: { data?: { error?: string } }) =>
    e?.data?.error ?? 'Something went wrong.',
  stamp: (iso: string | null) => (iso ? iso.slice(0, 16) : '-'),
}));
