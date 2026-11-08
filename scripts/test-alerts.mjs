import test from 'node:test';
import assert from 'node:assert/strict';
import {
  wantsEmailAlert,
  deliverAlert,
  alertCaveat,
  withinDeadline,
} from '../artifacts/api-server/src/lib/alert-policy.ts';

const since = new Date('2026-01-01T00:00:00Z');
const settings = {
  emailAlerts: true,
  emailAlertsSince: since,
  alertMailbox: 'owner@example.com',
  notifyOpens: true,
  notifyClicks: true,
};
const event = {
  type: 'open',
  automated: false,
  occurredAt: new Date(since.getTime() + 1000),
};

test('email delivery requires explicit consent, a mailbox and an allowed live signal', () => {
  assert.equal(wantsEmailAlert(settings, event), true);
  for (const patch of [
    { emailAlerts: false },
    { emailAlertsSince: null },
    { alertMailbox: null },
    { notifyOpens: false },
  ])
    assert.equal(wantsEmailAlert({ ...settings, ...patch }, event), false);
  assert.equal(wantsEmailAlert(undefined, event), false);
  assert.equal(wantsEmailAlert(settings, { ...event, automated: true }), false);
  assert.equal(wantsEmailAlert(settings, { ...event, type: 'sent' }), false);
  assert.equal(
    wantsEmailAlert(settings, {
      ...event,
      occurredAt: new Date(since.getTime() - 1),
    }),
    false,
  );
  assert.equal(
    wantsEmailAlert(settings, event, new Date(since.getTime() - 1)),
    false,
    'old consent generation cannot revive',
  );
  assert.equal(wantsEmailAlert(settings, { ...event, type: 'click' }), true);
  assert.equal(
    wantsEmailAlert(
      { ...settings, notifyClicks: false },
      { ...event, type: 'click' },
    ),
    false,
  );
  assert.match(alertCaveat, /not proof.*human read/);
});

function fixture({
  claim = true,
  failSend = false,
  found = null,
  failFinish = false,
} = {}) {
  const calls = [];
  return {
    calls,
    transport: {
      claim: async () => {
        calls.push('claim');
        return claim;
      },
      send: async () => {
        calls.push('send');
        if (failSend) throw new Error('timeout after acceptance');
        return 'gmail-id';
      },
      reconcile: async () => {
        calls.push('reconcile');
        return found;
      },
      finish: async (status, id) => {
        calls.push([status, id]);
        if (failFinish) throw new Error('DB offline');
      },
    },
  };
}
test('only the successful durable claimant sends', async () => {
  const f = fixture();
  await deliverAlert('pending', f.transport);
  assert.deepEqual(f.calls, ['claim', 'send', ['sent', 'gmail-id']]);
  const loser = fixture({ claim: false });
  await deliverAlert('pending', loser.transport);
  assert.deepEqual(loser.calls, ['claim']);
});
test('ambiguous sends are held and never retried even when Sent search finds nothing', async () => {
  const f = fixture({ failSend: true });
  await deliverAlert('pending', f.transport);
  assert.deepEqual(f.calls, ['claim', 'send', ['uncertain', undefined]]);
  for (const status of ['sending', 'uncertain']) {
    const absent = fixture();
    await deliverAlert(status, absent.transport);
    assert.deepEqual(absent.calls, ['reconcile', ['uncertain', undefined]]);
    const found = fixture({ found: 'already-sent' });
    await deliverAlert(status, found.transport);
    assert.deepEqual(found.calls, ['reconcile', ['sent', 'already-sent']]);
  }
});
test('a crash persisting a successful send leaves durable sending for reconciliation', async () => {
  const f = fixture({ failFinish: true });
  await assert.rejects(deliverAlert('pending', f.transport), /DB offline/);
  assert.equal(f.calls.filter((c) => c === 'send').length, 1);
});
test('reconciliation failure never falls through to sending', async () => {
  const f = fixture();
  f.transport.reconcile = async () => {
    throw new Error('Gmail offline');
  };
  await assert.rejects(deliverAlert('uncertain', f.transport), /Gmail offline/);
  assert.deepEqual(f.calls, []);
});
test('a stuck provider times out without a retry and successful requests clear their timer', async () => {
  assert.equal(await withinDeadline(Promise.resolve('done'), 10), 'done');
  const f = fixture();
  f.transport.send = () => withinDeadline(new Promise(() => {}), 5);
  await deliverAlert('pending', f.transport);
  assert.deepEqual(f.calls, ['claim', ['uncertain', undefined]]);
});
