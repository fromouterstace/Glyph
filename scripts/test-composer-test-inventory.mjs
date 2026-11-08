import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertComposerInventory,
  composerSuites,
  assertRunnerInventory,
  requiredRunners,
} from './lib/composer-test-inventory.mjs';
import { assertUnitInventory, requiredUnitSuites } from './lib/test-policy.mjs';

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

const runnerFixture = () => ({
  ...Object.fromEntries(
    Object.entries(requiredRunners).map(([runner, required]) => [
      runner,
      required.join(' '),
    ]),
  ),
  'test:gmail-extension':
    'tsx --test test-gmail-extension.mjs test-gmail-background.mjs',
});

test('dedicated runners include every critical boundary', () => {
  assert.doesNotThrow(() => assertRunnerInventory(runnerFixture()));
});

for (const [runner, required] of Object.entries(requiredRunners)) {
  test(`${runner} cannot silently omit one of its critical boundaries`, () => {
    for (const omitted of required) {
      const scripts = runnerFixture();
      scripts[runner] = required.filter((name) => name !== omitted).join(' ');
      assert.throws(() => assertRunnerInventory(scripts), /omits required/);
    }
  });
}

test('standalone extension contracts cannot regress to the plain Node runner', () => {
  const scripts = runnerFixture();
  scripts['test:gmail-extension'] =
    'node --test test-gmail-extension.mjs test-gmail-background.mjs';
  assert.throws(() => assertRunnerInventory(scripts), /TypeScript-aware/);
});

test('required unit discovery accepts the current suites and rejects every omitted boundary', () => {
  assert.doesNotThrow(() => assertUnitInventory(requiredUnitSuites));
  for (const omitted of requiredUnitSuites)
    assert.throws(
      () =>
        assertUnitInventory(
          requiredUnitSuites.filter((name) => name !== omitted),
        ),
      /Required unit suites missing/,
    );
});
