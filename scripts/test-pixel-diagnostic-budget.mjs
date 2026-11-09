import test from 'node:test';
import assert from 'node:assert/strict';
import { createPixelDiagnosticBudget } from '../artifacts/api-server/src/lib/pixel-diagnostic-budget.ts';

test('unknown and ignored traffic cannot force unbounded diagnostic writes', () => {
  let now = 0;
  const budget = createPixelDiagnosticBudget(() => now);
  const admit = (outcome, attempts) => {
    let accepted = 0;
    for (let i = 0; i < attempts; i++) {
      const release = budget.acquire(outcome);
      if (release) {
        accepted++;
        release();
      }
    }
    return accepted;
  };
  assert.equal(admit('unknown_token', 1000), 10);
  assert.equal(admit('event_budget_exceeded', 1000), 60);
  assert.equal(admit('sender_compose_ignored', 1000), 0);
  assert.equal(admit('recorded', 1000), 530);
  now = 60_000;
  assert.equal(admit('unknown_token', 1000), 10);
});

test('concurrent diagnostic writes are bounded even across window rollover', () => {
  let now = 0;
  const budget = createPixelDiagnosticBudget(() => now);
  const pending = Array.from({ length: 4 }, () => budget.acquire('recorded'));
  assert.ok(pending.every(Boolean));
  assert.equal(budget.acquire('recorded'), undefined);
  now = 60_000;
  assert.equal(budget.acquire('unknown_token'), undefined);
  pending[0]();
  const next = budget.acquire('recorded');
  assert.ok(next);
  next();
  pending.slice(1).forEach((release) => release());
});
