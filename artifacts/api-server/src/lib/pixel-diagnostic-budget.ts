/** Best-effort telemetry must never create an unbounded public DB write path.
 * Constant-space, per-process bounds, independent of attacker-supplied tokens.
 */
export function createPixelDiagnosticBudget(now = Date.now) {
  let window = -1;
  let total = 0;
  let unknown = 0;
  let skipped = 0;
  let inFlight = 0;
  return {
    acquire(outcome: string): (() => void) | undefined {
      const current = Math.floor(now() / 60_000);
      if (current !== window) {
        window = current;
        total = unknown = skipped = 0;
      }
      const anonymous = outcome === 'unknown_token';
      const ignored = outcome !== 'recorded' && !anonymous;
      if (
        inFlight >= 4 ||
        total >= 600 ||
        (anonymous && unknown >= 10) ||
        (ignored && skipped >= 60)
      )
        return undefined;
      total++;
      if (anonymous) unknown++;
      if (ignored) skipped++;
      inFlight++;
      return () => {
        inFlight--;
      };
    },
  };
}
