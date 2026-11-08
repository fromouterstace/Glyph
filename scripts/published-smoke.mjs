import { runPublishedSmoke } from './lib/published-smoke.mjs';

const args = process.argv.slice(2).filter((arg) => arg !== '--');
try {
  await runPublishedSmoke({
    origins: args.length
      ? args
      : [
          process.env.GLYPH_SMOKE_ORIGIN ?? '',
          ...(process.env.GLYPH_SMOKE_ADDITIONAL_ORIGINS ?? '')
            .split(/\s+/)
            .filter(Boolean),
        ],
    report: (row) => console.log(JSON.stringify(row)),
  });
  console.log(
    'Published smoke passed on all origins. Browser sign-in, OAuth and live Gmail delivery still require controlled evidence.',
  );
} catch (error) {
  console.error(`Published smoke failed: ${error.message}`);
  process.exitCode = 1;
}
