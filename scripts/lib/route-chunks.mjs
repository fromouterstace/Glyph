import assert from 'node:assert/strict';

export const protectedPages = [
  'dashboard',
  'emails',
  'activity',
  'settings',
  'gmail',
  'contacts',
  'contact-detail',
  'system',
].map((page) => `src/pages/${page}.tsx`);

export function checkRouteChunks(manifest) {
  const entry = manifest['index.html'];
  assert.ok(entry?.isEntry, 'The frontend entry must be present.');
  const eager = new Set();
  const visit = (key) => {
    if (eager.has(key)) return;
    eager.add(key);
    assert.ok(manifest[key], `Missing static chunk: ${key}`);
    for (const dependency of manifest[key].imports ?? []) visit(dependency);
  };
  visit('index.html');
  const files = new Set();
  for (const page of protectedPages) {
    const chunk = manifest[page];
    assert.ok(chunk?.isDynamicEntry, `${page} must remain a lazy entry.`);
    assert.ok(!eager.has(page), `${page} must not be eagerly imported.`);
    assert.ok(
      chunk.file && chunk.file !== entry.file,
      `${page} needs its own output chunk.`,
    );
    assert.ok(
      !files.has(chunk.file),
      `${page} must not share another page's entry chunk.`,
    );
    files.add(chunk.file);
  }
}
