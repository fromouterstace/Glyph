import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertComposerInventory,
  composerSuites,
} from './lib/composer-test-inventory.mjs';

for (const layer of Object.keys(composerSuites)) {
  test(`${layer} composer gate accepts the required suites with unrelated tests`, () => {
    const discovered = [...composerSuites[layer], 'unrelated.test.tsx'].map(
      (file) => ({ file }),
    );
    assert.doesNotThrow(() =>
      assertComposerInventory(layer, discovered, '/workspace'),
    );
  });
  for (const omitted of composerSuites[layer]) {
    test(`${omitted} cannot silently disappear from the composer gate`, () => {
      const discovered = composerSuites[layer]
        .filter((file) => file !== omitted)
        .map((file) => ({ file }));
      assert.throws(
        () => assertComposerInventory(layer, discovered, '/workspace'),
        (error) => error.message.includes(omitted),
      );
    });
  }
}
