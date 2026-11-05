import { readFile, writeFile, rename, open, unlink } from 'node:fs/promises';
import {
  parseLedger,
  recordRelease,
  observeRelease,
  serializeLedger,
  summarizeReleases,
} from './lib/release-regression.mjs';

const ledger = new URL('../docs/regression-release-log.csv', import.meta.url);
const lock = new URL(
  '../docs/regression-release-log.csv.lock',
  import.meta.url,
);
const temporary = new URL(
  '../docs/regression-release-log.csv.tmp',
  import.meta.url,
);
const [command = 'report', release, detail] = process.argv
  .slice(2)
  .filter((arg) => arg !== '--');
let handle;
try {
  if (!['report', 'record', 'observe'].includes(command))
    throw new Error(
      'Use report, record <release> <published-UTC>, or observe <release> <evidence.json>.',
    );
  if (command !== 'report') handle = await open(lock, 'wx');
  let rows = parseLedger(await readFile(ledger, 'utf8'));
  if (command === 'record') rows = recordRelease(rows, release, detail);
  if (command === 'observe')
    rows = observeRelease(
      rows,
      release,
      JSON.parse(await readFile(detail, 'utf8')),
    );
  if (command !== 'report') {
    await writeFile(temporary, serializeLedger(rows));
    await rename(temporary, ledger);
  }
  console.log(JSON.stringify(summarizeReleases(rows), null, 2));
} catch (error) {
  console.error(
    error.code === 'EEXIST'
      ? 'Another release-ledger writer holds the lock.'
      : error.message,
  );
  process.exitCode = 1;
} finally {
  if (handle) {
    await handle.close();
    await unlink(lock);
  }
}
