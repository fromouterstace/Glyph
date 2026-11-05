import test from 'node:test';
import assert from 'node:assert/strict';
import {
  criticalSources,
  assertCoverageInventory,
} from './lib/coverage-inventory.mjs';

const cwd = '/workspace/scripts';
const report = (sources) =>
  sources.map((path) => `SF:${path}\nend_of_record`).join('\n');

test('coverage inventory accepts every required backend and frontend critical source', () => {
  assert.doesNotThrow(() =>
    assertCoverageInventory(report(criticalSources), cwd),
  );
});

for (const missing of criticalSources) {
  test(`coverage fails if ${missing} disappears even when other sources have high percentages`, () => {
    assert.throws(
      () =>
        assertCoverageInventory(
          report(criticalSources.filter((p) => p !== missing)),
          cwd,
        ),
      /Critical coverage sources missing/,
    );
  });
}

test('an empty report cannot pass the coverage gate', () => {
  assert.throws(() => assertCoverageInventory('', cwd), /sources missing/);
});
