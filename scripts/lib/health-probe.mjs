import { setTimeout as delay } from 'node:timers/promises';

export function smokeOrigin(value) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (
    !['http:', 'https:'].includes(url.protocol) ||
    (!local && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.pathname !== '/' ||
    url.search ||
    url.hash
  )
    throw new Error(
      'Use an HTTPS origin, or a local HTTP origin, without credentials or a path.',
    );
  return url.origin;
}

export async function waitForHealth({
  base,
  fetchImpl = fetch,
  now = Date.now,
  sleep = delay,
  budgetMs = 15_000,
  attemptTimeoutMs = 3_000,
  intervalMs = 250,
}) {
  const origin = smokeOrigin(base);
  for (const value of [budgetMs, attemptTimeoutMs, intervalMs]) {
    if (!Number.isFinite(value) || value <= 0)
      throw new Error(
        'Health probe time budgets must be positive finite numbers.',
      );
  }
  const deadline = now() + budgetMs;
  let outcome = 'unreachable';
  while (now() < deadline) {
    try {
      const response = await fetchImpl(`${origin}/api/healthz`, {
        redirect: 'manual',
        signal: AbortSignal.timeout(
          Math.max(1, Math.min(attemptTimeoutMs, deadline - now())),
        ),
      });
      outcome = `HTTP ${response.status}`;
      if (response.status === 200 && (await response.json()).status === 'ok')
        return;
    } catch {
      outcome = 'unreachable or invalid health response';
    }
    const remaining = deadline - now();
    if (remaining > 0) await sleep(Math.min(intervalMs, remaining));
  }
  throw new Error(
    `API health preflight timed out after ${budgetMs}ms (${outcome}).`,
  );
}
