import { useAuth } from '@clerk/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getGetOverviewQueryKey,
  getListActivityQueryKey,
  getGetSettingsQueryKey,
  getGetConnectionQueryKey,
} from '@workspace/api-client-react';
import { formatDistanceToNowStrict, format } from 'date-fns';

export const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export function useSession() {
  const { isLoaded, isSignedIn } = useAuth();
  return { isLoaded, isSignedIn: !!isSignedIn };
}

/** Poll every 10s only when an authenticated session exists. */
export function usePoll() {
  const { isSignedIn } = useSession();
  return isSignedIn ? 10_000 : (false as const);
}

export function useInvalidateAll() {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: ['/api/glyph/messages'], exact: false });
    qc.invalidateQueries({
      predicate: (q) =>
        String(q.queryKey[0] ?? '').startsWith('/api/glyph/messages'),
    });
    qc.invalidateQueries({ queryKey: getGetOverviewQueryKey() });
    qc.invalidateQueries({ queryKey: getListActivityQueryKey() });
    qc.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
    qc.invalidateQueries({ queryKey: getGetConnectionQueryKey() });
  };
}

export function errorText(err: unknown): string {
  const e = err as { status?: number; data?: unknown; message?: string } | null;
  const d = e?.data as Record<string, unknown> | null | undefined;
  const msg =
    (d && typeof d === 'object' && (d.error || d.message || d.detail)) ||
    undefined;
  if (e?.status === 401) return 'Sign in to do that.';
  if (e?.status === 403)
    return typeof msg === 'string'
      ? msg
      : 'Connect your own Gmail account from the Gmail page to send.';
  if (typeof msg === 'string') return msg;
  return e?.message ?? 'Something went wrong.';
}

export function ago(iso: string | null | undefined) {
  if (!iso) return '—';
  return formatDistanceToNowStrict(new Date(iso), { addSuffix: true });
}
export function stamp(iso: string | null | undefined) {
  if (!iso) return '—';
  return format(new Date(iso), 'MMM d, HH:mm');
}
export function pct(n: number) {
  return `${n.toFixed(1)}%`;
}
export function initials(name: string, email: string) {
  const s = (name || email || '?').trim();
  const p = s.split(/[\s@.]+/).filter(Boolean);
  return ((p[0]?.[0] ?? '') + (p[1]?.[0] ?? '')).toUpperCase() || '?';
}
