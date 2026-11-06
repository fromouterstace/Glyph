import test from 'node:test';
import assert from 'node:assert/strict';
import {
  configuredSystemAdminEmails,
  isSystemAdmin,
} from '../artifacts/api-server/src/lib/system-admin.ts';

const verified = (emailAddress) => ({
  emailAddress,
  verification: { status: 'verified' },
});

test('admin email configuration is trimmed, case-insensitive, and ignores blanks', () => {
  assert.deepEqual(
    [...configuredSystemAdminEmails(' Admin@Example.com, ,other@example.com ')],
    ['admin@example.com', 'other@example.com'],
  );
  assert.equal(configuredSystemAdminEmails(undefined).size, 0);
});

test('only a verified configured email grants system access', async () => {
  const getUser = async () => ({
    emailAddresses: [
      {
        emailAddress: 'admin@example.com',
        verification: { status: 'unverified' },
      },
      verified('ADMIN@example.com'),
    ],
  });
  assert.equal(
    await isSystemAdmin('user_1', ' Admin@example.com ', getUser),
    true,
  );
  assert.equal(
    await isSystemAdmin('user_1', 'other@example.com', getUser),
    false,
  );
  assert.equal(await isSystemAdmin(null, 'admin@example.com', getUser), false);
  assert.equal(await isSystemAdmin('user_1', undefined, getUser), false);
});

test('missing allowlist denies access without looking up a user', async () => {
  let lookedUp = false;
  const allowed = await isSystemAdmin('user_1', '', async () => {
    lookedUp = true;
    return { emailAddresses: [verified('admin@example.com')] };
  });
  assert.equal(allowed, false);
  assert.equal(lookedUp, false);
});
