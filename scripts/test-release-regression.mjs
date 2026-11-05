import test from 'node:test';
import assert from 'node:assert/strict';
import {
  columns,
  parseLedger,
  serializeLedger,
  recordRelease,
  observeRelease,
  summarizeReleases,
} from './lib/release-regression.mjs';

const published = '2026-10-01T00:00:00.000Z';
const early = Date.parse('2026-10-02T00:00:00Z');
const mature = Date.parse('2026-10-09T00:00:00Z');
const release = () => recordRelease([], 'release-one', published, early);

test('an empty or merely aged release ledger never claims zero regressions', () => {
  assert.equal(summarizeReleases([]).regressionRate, null);
  const aged = summarizeReleases(release(), mature);
  assert.equal(aged.completedObservations, 0);
  assert.equal(aged.unobservedMatureReleases, 1);
  assert.equal(aged.regressionRate, null);
});

test('a clean observation requires an explicit outcome, evidence and a completed window', () => {
  assert.throws(
    () =>
      observeRelease(
        release(),
        'release-one',
        {
          regression_found: 'false',
          detection: 'Reviewed controlled release evidence',
        },
        early,
      ),
    /completed/,
  );
  assert.throws(
    () =>
      observeRelease(
        release(),
        'release-one',
        { regression_found: 'false' },
        mature,
      ),
    /evidence/,
  );
  const observed = observeRelease(
    release(),
    'release-one',
    { regression_found: 'false', detection: 'Reviewed seven-day evidence' },
    mature,
  );
  assert.equal(summarizeReleases(observed, mature).regressionRate, 0);
});

test('confirmed regressions count once per release and cannot be silently erased', () => {
  const evidence = {
    regression_found: 'true',
    invariant: 'Readiness',
    severity: 'medium',
    detection: 'Controlled monitor observation',
    regression_test: 'test-database-readiness.mjs',
  };
  const observed = observeRelease(release(), 'release-one', evidence, mature);
  assert.equal(summarizeReleases(observed, mature).regressionRate, 1);
  assert.throws(
    () =>
      observeRelease(
        observed,
        'release-one',
        { regression_found: 'false', detection: 'Changed my mind' },
        mature,
      ),
    /cannot be erased/,
  );
});

test('release records reject duplicates and future publication dates', () => {
  assert.throws(
    () => recordRelease(release(), 'release-one', published, mature),
    /already/,
  );
  assert.throws(
    () => recordRelease([], 'future', '2027-01-01T00:00:00Z', mature),
    /future/,
  );
  assert.throws(() => parseLedger('incorrect,header\n'), /header/);
  assert.equal(parseLedger(`${columns.join(',')}\n`).length, 0);
});

test('CSV evidence containing quotes, commas and newlines round-trips without losing observations', () => {
  const rows = observeRelease(
    release(),
    'release-one',
    {
      regression_found: 'false',
      detection: 'Checked "daily",\nreviewed evidence',
    },
    mature,
  );
  assert.deepEqual(parseLedger(serializeLedger(rows)), rows);
});
