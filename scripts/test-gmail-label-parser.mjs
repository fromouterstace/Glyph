import test from 'node:test';
import assert from 'node:assert/strict';
import {
  labelAddresses,
  parseLabelMessage,
} from '../artifacts/api-server/src/lib/gmail-label-parser.ts';

const own = 'me@example.invalid';
const message = (headers = [], payload = {}) => ({
  id: 'gmail-message-1',
  internalDate: '1794175200000',
  payload: {
    headers,
    mimeType: 'text/plain',
    body: { data: Buffer.from('A private note').toString('base64url') },
    ...payload,
  },
});
test('label contacts preserve display names, normalize domains, and do not invent missing names', () => {
  assert.deepEqual(
    labelAddresses(
      '"Ada Lovelace" <ADA@Example.Invalid>, bare@example.invalid',
    ),
    [
      {
        firstName: 'Ada',
        lastName: 'Lovelace',
        email: 'ada@example.invalid',
        emailSuffix: 'example.invalid',
      },
      {
        firstName: '',
        lastName: '',
        email: 'bare@example.invalid',
        emailSuffix: 'example.invalid',
      },
    ],
  );
});
test('encoded display names and quoted commas are not treated as extra addresses', () => {
  assert.equal(
    labelAddresses('=?UTF-8?B?Sm9zw6kgR2FyY2lh?= <jose@example.invalid>')[0]
      .firstName,
    'José',
  );
  assert.equal(labelAddresses('"Doe, Jane" <jane@example.invalid>').length, 1);
  assert.deepEqual(labelAddresses('not an email, <broken>'), []);
});
test('imports extract only visible correspondents, exclude the owner and deduplicate roles', () => {
  const parsed = parseLabelMessage(
    message([
      { name: 'From', value: 'Ada Lovelace <ada@example.invalid>' },
      { name: 'To', value: own },
      {
        name: 'Cc',
        value: 'ada@example.invalid, Grace Hopper <grace@example.invalid>',
      },
      { name: 'Bcc', value: 'hidden@example.invalid' },
      { name: 'Subject', value: 'Notes' },
    ]),
    own,
  );
  assert.deepEqual(
    parsed.contacts.map((c) => c.email),
    ['ada@example.invalid', 'grace@example.invalid', 'hidden@example.invalid'],
  );
  assert.equal(parsed.values.body, 'A private note');
  assert.equal(parsed.values.recipientEmail, 'ada@example.invalid');
});
test('untrusted HTML is imported as bounded text, never executable HTML or attachment bytes', () => {
  const value = parseLabelMessage(
    message([], {
      mimeType: 'multipart/mixed',
      body: {},
      parts: [
        {
          mimeType: 'text/html',
          body: {
            data: Buffer.from(
              '<script>bad()</script><p>Hello &amp; goodbye</p>',
            ).toString('base64url'),
          },
        },
      ],
    }),
    own,
  );
  assert.equal(value.values.body, 'Hello & goodbye');
  const long = parseLabelMessage(
    message([], {
      body: { data: Buffer.from('x'.repeat(60_000)).toString('base64url') },
    }),
    own,
  );
  assert.equal(long.values.body.length, 50_000);
});
test('incomplete provider messages and invalid timestamps fail explicitly', () => {
  assert.throws(() => parseLabelMessage({ id: 'missing' }, own), /incomplete/);
  assert.throws(
    () => parseLabelMessage({ ...message(), internalDate: 'invalid' }, own),
    /date/,
  );
});

test('header decoding supports quoted-printable words and preserves unknown encodings safely', () => {
  const parsed = parseLabelMessage(
    message([
      { name: 'Subject', value: '=?UTF-8?Q?Hello_World?=' },
      { name: 'From', value: '=?not-a-charset?B?QQ==?= <a@example.invalid>' },
    ]),
    own,
  );
  assert.equal(parsed.values.subject, 'Hello World');
  assert.equal(
    labelAddresses('=?UTF-8?Q?Jos=C3=A9_Garcia?= <jose@example.invalid>')[0]
      .firstName,
    'José',
  );
  assert.match(parsed.contacts[0].firstName, /not-a-charset/);
  assert.deepEqual(labelAddresses(`<${'a'.repeat(260)}@example.invalid>`), []);
});
test('plain nested text wins and empty or overly nested MIME parts stay bounded', () => {
  const empty = parseLabelMessage(
    message([], { mimeType: 'multipart/mixed', body: {} }),
    own,
  );
  assert.equal(empty.values.body, '');
  assert.equal(empty.values.recipientEmail, own);
  const nested = {
    mimeType: 'text/plain',
    body: { data: Buffer.from('nested').toString('base64url') },
  };
  assert.equal(
    parseLabelMessage(
      message([], { mimeType: 'multipart/mixed', parts: [nested] }),
      own,
    ).values.body,
    'nested',
  );
  let deep = nested;
  for (let i = 0; i < 12; i++)
    deep = { mimeType: 'multipart/mixed', parts: [deep] };
  assert.equal(parseLabelMessage(message([], deep), own).values.body, '');
});
