import { inspectDatabaseAccess } from '../artifacts/api-server/src/lib/database-access.ts';

try {
  const { pool } = await import('@workspace/db');
  try {
    const result = await inspectDatabaseAccess(pool);
    console.log(JSON.stringify(result));
    process.exitCode = result.safe ? 0 : 1;
  } finally {
    await pool.end();
  }
} catch {
  console.error(
    JSON.stringify({
      safe: false,
      issues: ['database_access_check_failed'],
    }),
  );
  process.exitCode = 1;
}
