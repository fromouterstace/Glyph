import { createHash } from 'node:crypto';

export const digest = (value) =>
  createHash('sha256').update(value).digest('hex');

// Deliberately conservative: this is a blocker, not a PostgreSQL parser.
// Unsupported SQL needs a separately reviewed policy change, not an override.
export function assertSafePlan(sql) {
  if (!sql.trim()) throw new Error('Schema plan must not be empty.');
  if (/\/\*|--|\$\$|\\/.test(sql))
    throw new Error('Comments, dollar quoting and escapes are not allowed.');
  for (const statement of sql.split(';').filter((part) => part.trim())) {
    // Expand-only preference columns. Never admit expression defaults, existing
    // column changes, constraints on populated rows, or arbitrary ALTER SQL.
    const identifier = '(?:"[a-z_][a-z0-9_]*"|[a-z_][a-z0-9_]*)';
    const additiveColumn = new RegExp(
      `^\\s*ALTER TABLE ${identifier} ADD COLUMN ${identifier} (?:text|timestamp with time zone|boolean(?: DEFAULT (?:true|false)(?: NOT NULL)?)?)\\s*$`,
      'i',
    );
    if (additiveColumn.test(statement)) continue;
    // ON DELETE CASCADE on a new FK preserves existing message-delete semantics;
    // it is not an instruction to cascade a schema contraction.
    const checked = statement.replace(/\bON DELETE CASCADE\b/gi, '');
    if (
      /\b(drop|truncate|delete|update|rename|cascade|execute|call|do|copy|grant|revoke|alter|insert|select|as)\b/i.test(
        checked,
      )
    )
      throw new Error('Destructive, data-changing or unsupported SQL blocked.');
    if (!/^\s*CREATE\s+(TABLE|(?:UNIQUE\s+)?INDEX)\s/i.test(statement))
      throw new Error(
        'Only reviewed additive CREATE TABLE/INDEX or safe ADD COLUMN plans allowed.',
      );
  }
}

export function assertReview(record, previousVersion) {
  if (
    record.version !== previousVersion + 1 ||
    !['baseline', 'expand'].includes(record.phase) ||
    (record.version > 1 && record.phase !== 'expand') ||
    !record.reason?.trim() ||
    !record.compatibility?.trim() ||
    !record.recovery?.trim() ||
    !record.schema ||
    Object.keys(record.schema).length === 0
  )
    throw new Error(
      'Invalid versioned schema review or missing safety evidence.',
    );
}

export function assertSchemaInventory(expected, actual) {
  if (
    JSON.stringify(Object.entries(expected).sort()) !==
    JSON.stringify(Object.entries(actual).sort())
  )
    throw new Error(
      'Schema drift: append a reviewed version; never edit history.',
    );
}

export function assertDevelopmentTarget(env, args) {
  if (
    env.NODE_ENV === 'production' ||
    env.GLYPH_DATABASE_TARGET !== 'development' ||
    args.length
  )
    throw new Error(
      'Dev push requires GLYPH_DATABASE_TARGET=development, no force flags, and a verified development connection. Production uses Publish only.',
    );
}

export function assertNoSchemaExecution(text) {
  if (
    /\.\s*delete\s*\(\s*(?:\w+\.)?glyph[A-Z]\w*|\bDELETE\s+FROM\s+(?:"?glyph_|\$\{\s*glyph[A-Z])/i.test(
      text,
    )
  )
    throw new Error(
      'Physical database deletion is forbidden in runtime/deploy paths.',
    );
  if (
    /\b(?:drizzle-kit\s+(?:push|migrate)|prisma\s+(?:db\s+push|migrate)|push-force|(?:CREATE|ALTER|DROP|TRUNCATE)\s+(?:TABLE|SCHEMA|DATABASE|INDEX|TYPE))\b/i.test(
      text,
    )
  )
    throw new Error('Schema execution is forbidden in runtime/deploy paths.');
}

export function assertImmutable(old, current) {
  if (!old.equals(current))
    throw new Error('Existing schema review history must be immutable.');
}

export function assertExpandOnly(previous, next) {
  for (const [table, columns] of Object.entries(previous)) {
    for (const [column, type] of Object.entries(columns)) {
      if (next[table]?.[column] !== type)
        throw new Error('Removal, rename, type or nullability change blocked.');
    }
  }
}

export function assertShape(expected, actual) {
  const normalize = (tables) =>
    Object.fromEntries(
      Object.entries(tables)
        .sort()
        .map(([name, columns]) => [name, Object.entries(columns).sort()]),
    );
  if (JSON.stringify(normalize(expected)) !== JSON.stringify(normalize(actual)))
    throw new Error(
      'Reviewed database shape does not match actual schema exports.',
    );
}
