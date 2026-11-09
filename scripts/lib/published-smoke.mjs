import { runSmoke } from './smoke-checks.mjs';

export const CANONICAL_PUBLISHED_ORIGIN = 'https://glyph.rocks';

export function publishedOrigins(values) {
  if (values.length < 2)
    throw new Error(
      'Published smoke requires the primary and alias HTTPS origins.',
    );
  const origins = values.map((value) => {
    try {
      const url = new URL(value);
      if (
        url.protocol !== 'https:' ||
        url.username ||
        url.password ||
        url.href !== `${url.origin}/`
      )
        throw new Error();
      return url.origin;
    } catch {
      throw new Error(
        'Published smoke accepts only bare HTTPS origins without credentials.',
      );
    }
  });
  if (new Set(origins).size !== origins.length)
    throw new Error('Published smoke origins must be distinct.');
  if (origins[0] !== CANONICAL_PUBLISHED_ORIGIN)
    throw new Error(
      `Published smoke primary must be ${CANONICAL_PUBLISHED_ORIGIN}.`,
    );
  return origins;
}

export async function runPublishedSmoke({
  origins,
  smoke = runSmoke,
  report = () => {},
}) {
  const targets = publishedOrigins(origins);
  const failures = [];
  for (const origin of targets) {
    report({ origin, outcome: 'started', at: new Date().toISOString() });
    try {
      await smoke({
        base: origin,
        requireContactChunks: true,
        report: (row) => report({ ...row, origin }),
      });
      report({ origin, outcome: 'passed', at: new Date().toISOString() });
    } catch (error) {
      failures.push(origin);
      report({
        origin,
        outcome: 'failed',
        error: error.message,
        at: new Date().toISOString(),
      });
    }
  }
  if (failures.length)
    throw new Error(`Published smoke failed for: ${failures.join(', ')}`);
}
