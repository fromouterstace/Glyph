import { serviceHarness, edge } from './service-harness.mjs';
import { DATABASE_APPROVERS } from '../../../artifacts/api-server/src/lib/database-approval-policy.ts';
export { edge, DATABASE_APPROVERS };
export const first = 'approval_first';
export const second = 'approval_second';
export const plan = {
  operation: 'delete_rows',
  target: 'public.glyph_messages',
  planSha256: 'a'.repeat(64),
  reason: 'Controlled request fixture; no execution',
};
export function resetApprovers() {
  edge.getUser.mockImplementation(async (id) => ({
    emailAddresses: (id === 'both'
      ? Object.values(DATABASE_APPROVERS)
      : [
          id === first
            ? DATABASE_APPROVERS.first
            : id === second
              ? DATABASE_APPROVERS.second
              : 'outside@example.invalid',
        ]
    ).map((emailAddress) => ({
      emailAddress,
      verification: { status: 'verified' },
    })),
  }));
}
export async function approvalHarness() {
  const h = await serviceHarness();
  resetApprovers();
  return {
    ...h,
    async create(overrides = {}) {
      return (
        await h.request('/database-approvals', {
          user: first,
          method: 'POST',
          body: { ...plan, ...overrides },
        })
      ).json();
    },
    action(row, user, action, digest = row.digest) {
      return h.request(`/database-approvals/${row.id}/action`, {
        user,
        method: 'POST',
        body: { action, digest },
      });
    },
  };
}
