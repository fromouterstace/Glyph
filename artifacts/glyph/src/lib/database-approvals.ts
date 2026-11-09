import { useAuth } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetDatabaseApprovalAccessQueryKey,
  getListDatabaseApprovalsQueryKey,
  useActOnDatabaseApproval,
  useCreateDatabaseApproval,
  useGetDatabaseApprovalAccess,
  useListDatabaseApprovals,
  type DatabaseApproval,
} from '@workspace/api-client-react';

export const APPROVAL_PAGE_SIZE = 50;
export const APPROVAL_POLL_MS = 15_000;

export const OPERATIONS = [
  { value: 'delete_rows', label: 'Delete rows' },
  { value: 'truncate_table', label: 'Truncate table' },
  { value: 'drop_object', label: 'Drop object' },
  { value: 'change_privileges', label: 'Change privileges' },
] as const;
export type ApprovalOperation = (typeof OPERATIONS)[number]['value'];

export const TARGET_PATTERN = /^[a-zA-Z0-9_.:-]+$/;
export const SHA_PATTERN = /^[a-f0-9]{64}$/;

export function operationLabel(op: string) {
  return OPERATIONS.find((o) => o.value === op)?.label ?? op;
}

/** Client-side view of expiry; the server remains authoritative. */
export function isPastExpiry(
  a: Pick<DatabaseApproval, 'expiresAt'>,
  now = Date.now(),
) {
  return new Date(a.expiresAt).getTime() <= now;
}

export function effectiveStatus(a: DatabaseApproval, now = Date.now()) {
  if (
    (a.status === 'pending' || a.status === 'approved') &&
    isPastExpiry(a, now)
  )
    return 'expired' as const;
  return a.status;
}

function isApprovalsKey(key: readonly unknown[]) {
  return key[0] === getListDatabaseApprovalsQueryKey()[0];
}

/** Access check keyed by Clerk user so cached results never cross accounts. */
export function useApprovalAccess() {
  const { isLoaded, userId } = useAuth();
  return useGetDatabaseApprovalAccess({
    query: {
      enabled: isLoaded && !!userId,
      retry: false,
      staleTime: 60_000,
      queryKey: [
        ...getGetDatabaseApprovalAccessQueryKey(),
        userId ?? 'signed-out',
      ],
    },
  });
}

export function useApprovalList(offset: number, enabled: boolean) {
  const { userId } = useAuth();
  const params = { offset };
  return useListDatabaseApprovals(params, {
    query: {
      enabled: enabled && !!userId,
      retry: false,
      refetchInterval: APPROVAL_POLL_MS,
      queryKey: [
        ...getListDatabaseApprovalsQueryKey(params),
        userId ?? 'signed-out',
      ],
    },
  });
}

function useRefreshApprovals() {
  const qc = useQueryClient();
  return () =>
    qc.invalidateQueries({ predicate: (q) => isApprovalsKey(q.queryKey) });
}

export function useCreateApproval() {
  const refresh = useRefreshApprovals();
  return useCreateDatabaseApproval({
    mutation: { retry: false, onSettled: () => void refresh() },
  });
}

export function useApprovalAction() {
  const refresh = useRefreshApprovals();
  return useActOnDatabaseApproval({
    mutation: { retry: false, onSettled: () => void refresh() },
  });
}
