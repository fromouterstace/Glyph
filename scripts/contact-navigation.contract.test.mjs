import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../artifacts/glyph/src/App.tsx', import.meta.url),
  'utf8',
);
function assertRoutes(text) {
  assert.match(
    text,
    /const ContactDetailPage = lazy\(\(\) => import\('@\/pages\/contact-detail'\)\)/,
  );
  assert.match(text, /const ContactDetailRoute = wrap\(ContactDetailPage\)/);
  assert.match(
    text,
    /<Route path="\/contacts\/:id" component=\{ContactDetailRoute\}/,
  );
  assert.match(text, /const ContactsRoute = wrap\(ContactsPage\)/);
  assert.match(text, /<Route path="\/contacts" component=\{ContactsRoute\}/);
}
test('the actual app registers both contact routes through the sign-in wall', () => {
  assertRoutes(source);
});
test('omitting the contact profile route or its protected wrapper fails the contract', () => {
  for (const broken of [
    source.replace(
      '<Route path="/contacts/:id" component={ContactDetailRoute} />',
      '',
    ),
    source.replace('wrap(ContactDetailPage)', 'ContactDetailPage'),
  ]) {
    assert.notEqual(broken, source);
    assert.throws(() => assertRoutes(broken));
  }
});
