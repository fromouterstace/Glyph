export const columns = [
  'release',
  'published_at',
  'observation_end',
  'regression_found',
  'invariant',
  'severity',
  'detection',
  'regression_test',
];
const week = 7 * 24 * 60 * 60 * 1_000;

function instant(value) {
  if (
    typeof value !== 'string' ||
    !value.endsWith('Z') ||
    !Number.isFinite(Date.parse(value))
  )
    throw new Error('Use a valid UTC ISO timestamp ending in Z.');
  return Date.parse(value);
}

export function parseLedger(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (char === '"') {
      if (quoted && text[index + 1] === '"') {
        field += '"';
        index++;
      } else quoted = !quoted;
    } else if (char === ',' && !quoted) {
      row.push(field);
      field = '';
    } else if (char === '\n' && !quoted) {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r' || quoted) field += char;
  }
  if (quoted) throw new Error('Unclosed CSV quote.');
  if (field || row.length) rows.push([...row, field]);
  if (JSON.stringify(rows.shift()) !== JSON.stringify(columns))
    throw new Error('Unexpected release ledger header.');
  const ids = new Set();
  return rows
    .filter((cells) => cells.some(Boolean))
    .map((cells) => {
      if (cells.length !== columns.length)
        throw new Error('Invalid release ledger row.');
      const value = Object.fromEntries(
        columns.map((name, index) => [name, cells[index]]),
      );
      validateRow(value);
      if (ids.has(value.release))
        throw new Error('Duplicate release in ledger.');
      ids.add(value.release);
      return value;
    });
}

function validateRow(row) {
  if (!/^[a-zA-Z0-9._-]{1,100}$/.test(row.release))
    throw new Error('Invalid release identifier.');
  if (instant(row.observation_end) - instant(row.published_at) < week)
    throw new Error('Observation windows must cover at least seven days.');
  if (!['unknown', 'true', 'false'].includes(row.regression_found))
    throw new Error('Regression outcome must be unknown, true, or false.');
  if (row.regression_found !== 'unknown' && !row.detection.trim())
    throw new Error('A measured outcome requires observation evidence.');
  if (
    row.regression_found === 'true' &&
    [row.invariant, row.severity, row.regression_test].some(
      (value) => !value.trim(),
    )
  )
    throw new Error(
      'Confirmed regressions require invariant, severity, and regression-test evidence.',
    );
}

export function serializeLedger(rows) {
  for (const row of rows) validateRow(row);
  const quote = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  return `${columns.join(',')}\n${rows.map((row) => columns.map((name) => quote(row[name])).join(',')).join('\n')}${rows.length ? '\n' : ''}`;
}

export function recordRelease(rows, release, publishedAt, now = Date.now()) {
  const published = instant(publishedAt);
  if (published > now) throw new Error('Cannot record a future publication.');
  if (rows.some((row) => row.release === release))
    throw new Error('Release already recorded.');
  const row = {
    ...Object.fromEntries(columns.map((name) => [name, ''])),
    release,
    published_at: new Date(published).toISOString(),
    observation_end: new Date(published + week).toISOString(),
    regression_found: 'unknown',
  };
  validateRow(row);
  return [...rows, row];
}

export function observeRelease(rows, release, evidence, now = Date.now()) {
  const index = rows.findIndex((row) => row.release === release);
  if (index < 0) throw new Error('Record the actual publication first.');
  const old = rows[index];
  if (!['true', 'false'].includes(evidence.regression_found))
    throw new Error('An observation must explicitly report true or false.');
  if (old.regression_found === 'true' && evidence.regression_found !== 'true')
    throw new Error('A confirmed regression cannot be erased.');
  if (
    evidence.regression_found === 'false' &&
    instant(old.observation_end) > now
  )
    throw new Error(
      'A clean observation requires the completed seven-day window.',
    );
  const observed = { ...old };
  for (const name of [
    'regression_found',
    'invariant',
    'severity',
    'detection',
    'regression_test',
  ])
    observed[name] = String(evidence[name] ?? '');
  validateRow(observed);
  return rows.map((row, position) => (position === index ? observed : row));
}

export function summarizeReleases(rows, now = Date.now()) {
  const mature = rows.filter((row) => instant(row.observation_end) <= now);
  const observed = mature.filter((row) => row.regression_found !== 'unknown');
  const regressed = observed.filter(
    (row) => row.regression_found === 'true',
  ).length;
  return {
    releases: rows.length,
    completedObservations: observed.length,
    regressedReleases: regressed,
    regressionRate: observed.length ? regressed / observed.length : null,
    unobservedMatureReleases: mature.length - observed.length,
    pendingWindows: rows.length - mature.length,
    conclusion: observed.length
      ? 'Observed release rate, not a guarantee or confidence bound.'
      : 'Unknown: no completed release observations.',
  };
}
