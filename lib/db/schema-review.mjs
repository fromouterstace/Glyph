import { is, Table } from 'drizzle-orm';
import { getTableConfig } from 'drizzle-orm/pg-core';
import * as schema from './src/schema/index.ts';

// Import schema only, never the database client. Invoked through tsx.
const result = {};
for (const table of Object.values(schema)) {
  if (!is(table, Table)) continue;
  const config = getTableConfig(table);
  result[config.name] = Object.fromEntries(
    config.columns.map((column) => [
      column.name,
      `${column.getSQLType()}${column.notNull ? '!' : '?'}`,
    ]),
  );
}
console.log(JSON.stringify(result));
