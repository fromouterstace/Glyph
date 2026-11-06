import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const openapi = await readFile(
  new URL('../lib/api-spec/openapi.yaml', import.meta.url),
  'utf8',
);
const schemaFiles = [
  '../lib/db/src/schema/glyph.ts',
  '../lib/db/src/schema/glyph-attachments.ts',
  '../lib/db/src/schema/glyph-system.ts',
];

const snakeCase = (value) =>
  value.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
function apiPropertyNames(document) {
  const names = [];
  const lines = document.split(/\r?\n/);
  for (let index = 0; index < lines.length; index++) {
    const block = /^(\s*)properties:\s*$/.exec(lines[index]);
    if (!block) continue;
    const propertyIndent = block[1].length + 2;
    for (let next = index + 1; next < lines.length; next++) {
      const line = lines[next];
      if (!line.trim()) continue;
      const indent = line.length - line.trimStart().length;
      if (indent < propertyIndent) break;
      if (indent !== propertyIndent) continue;
      const property = /^\s*([A-Za-z][A-Za-z0-9]*):/.exec(line);
      if (property) names.push(property[1]);
    }
  }
  return names;
}

test('database schema keeps snake_case storage columns behind camelCase Drizzle properties', async () => {
  const declarations = (
    await Promise.all(
      schemaFiles.map((file) =>
        readFile(new URL(file, import.meta.url), 'utf8'),
      ),
    )
  ).join('\n');
  const columns = [
    ...declarations.matchAll(
      /^\s{4}([a-z][A-Za-z0-9]*):\s+[A-Za-z][A-Za-z0-9]*\('([a-z][a-z0-9_]*)'/gm,
    ),
  ].map(([, property, column]) => ({ property, column }));
  assert.ok(columns.length > 20, 'Expected the complete Glyph DB schema');
  for (const { property, column } of columns) {
    assert.doesNotMatch(property, /_/);
    assert.equal(
      column,
      snakeCase(property),
      `Drizzle property ${property} must map to physical column ${snakeCase(property)}`,
    );
  }
});

test('OpenAPI JSON properties stay camelCase while snake_case remains valid in enum values', () => {
  const properties = apiPropertyNames(openapi);
  assert.ok(
    properties.length > 50,
    'Expected the complete OpenAPI property set',
  );
  assert.ok(properties.includes('messageId'));
  assert.ok(properties.includes('createdAt'));
  assert.ok(properties.includes('trackingBaseUrl'));
  assert.ok(properties.every((name) => !name.includes('_')));
  assert.match(openapi, /enum:\s*\[ready,\s*not_ready\]/);
});
