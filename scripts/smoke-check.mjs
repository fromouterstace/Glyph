import { runSmoke } from './lib/smoke-checks.mjs';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
try {
  if (args.length > 1) throw new Error('Pass at most one target origin.');
  await runSmoke({
    base: args[0] ?? process.env.GLYPH_HTTP_BASE_URL ?? 'http://127.0.0.1:80',
    report: (result) => console.log(JSON.stringify(result)),
  });
  console.log(
    'Smoke passed: HTTP delivery only; browser sign-in, database readiness, Gmail and real recipient delivery are not established.',
  );
} catch (error) {
  console.error(`Smoke failed: ${error.message}`);
  process.exitCode = 1;
}
