import { setTimeout as sleepFor } from 'node:timers/promises';

type ReadResponse = {
  status: number;
  headers: { get(name: string): string | null };
};

export class GmailRateLimitError extends Error {
  constructor(
    public readonly retryAt: number,
    now: number,
  ) {
    super(
      `Gmail checks are temporarily rate-limited. Try again in ${Math.max(1, Math.ceil((retryAt - now) / 1000))} seconds. Existing tracking and replies have not been removed.`,
    );
    this.name = 'GmailRateLimitError';
  }
}

export function createGmailReadGate({
  now = Date.now,
  sleep = sleepFor,
  spacingMs = 250,
} = {}) {
  let tail = Promise.resolve();
  let blockedUntil = 0;
  let lastStarted = -Infinity;
  let failures = 0;
  let pending = 0;
  const check = () => {
    if (blockedUntil > now())
      throw new GmailRateLimitError(blockedUntil, now());
  };
  return {
    isIdle: () => pending === 0 && blockedUntil <= now(),
    run<T extends ReadResponse>(request: () => Promise<T>): Promise<T> {
      pending++;
      const job = tail.then(async () => {
        check();
        const wait = lastStarted + spacingMs - now();
        if (wait > 0) await sleep(wait);
        check();
        lastStarted = now();
        const response = await request();
        if (response.status === 429) {
          failures++;
          const header = response.headers.get('retry-after')?.trim();
          const seconds =
            header && /^\d+(?:\.\d+)?$/.test(header) ? Number(header) : NaN;
          const date = header ? Date.parse(header) : NaN;
          const requested = Number.isFinite(seconds)
            ? now() + seconds * 1000
            : date;
          const fallback =
            now() + Math.min(900_000, 60_000 * 2 ** Math.min(failures - 1, 4));
          blockedUntil =
            Number.isFinite(requested) && requested > now()
              ? requested
              : fallback;
          throw new GmailRateLimitError(blockedUntil, now());
        }
        if (response.status >= 200 && response.status < 300) failures = 0;
        return response;
      });
      // A rejected read must not poison the queue or cause an automatic retry.
      tail = job.then(
        () => undefined,
        () => undefined,
      );
      return job.finally(() => {
        pending--;
      });
    },
  };
}
