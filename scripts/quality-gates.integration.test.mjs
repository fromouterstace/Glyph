import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtemp,
  readFile,
  writeFile,
  chmod,
  rm,
  access,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

function runLint(filename, input) {
  return spawnSync(
    'pnpm',
    [
      'exec',
      'eslint',
      '--stdin',
      '--stdin-filename',
      filename,
      '--format',
      'json',
    ],
    {
      cwd: new URL('..', import.meta.url),
      input,
      encoding: 'utf8',
      timeout: 20_000,
    },
  );
}

function testCase(title, lines) {
  return `test(${JSON.stringify(title)}, () => {\n${'  assert.ok(true);\n'.repeat(lines)}});`;
}

function sizePolicySource(maximum) {
  return [
    "import test from 'node:test';",
    "import assert from 'node:assert/strict';",
    testCase('within the layer budget', maximum - 10),
    testCase('over the layer budget', maximum + 10),
    '',
  ].join('\n');
}

test('the coverage inventory CLI rejects a report with omitted critical sources', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'glyph-inventory-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const report = join(directory, 'incomplete.lcov');
  await writeFile(report, 'SF:irrelevant.ts\nLF:1\nLH:1\nend_of_record\n');
  const result = spawnSync(
    process.execPath,
    [
      new URL('./check-coverage-inventory.mjs', import.meta.url).pathname,
      report,
    ],
    { encoding: 'utf8', timeout: 5_000 },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Critical coverage sources missing/);
});

test('release lint rejects skipped tests, option-based skips, and chained focus', () => {
  const result = runLint(
    'scripts/test-injected-policy.mjs',
    "import test from 'node:test';\n" +
      "test.skip('disabled', () => {});\n" +
      "test('disabled', {skip: true}, () => {});\n" +
      "test.only.each([])('focused', () => {});\n",
  );
  assert.equal(result.status, 1, 'Disabled or focused cases must fail lint.');
  const findings = JSON.parse(result.stdout).flatMap((file) => file.messages);
  assert.equal(
    findings.filter((finding) => finding.ruleId === 'no-restricted-syntax')
      .length,
    3,
    'Every supported test-hiding syntax must be rejected, including chained calls.',
  );
});

test('lint enforces the 50/100/150/200-line budgets by test layer', () => {
  const layers = [
    ['scripts/test-unit-budget.mjs', 50, 'unit'],
    ['scripts/budget.contract.test.mjs', 100, 'contract'],
    ['scripts/tests/budget.integration.test.mjs', 150, 'integration'],
    ['scripts/tests/budget.e2e.test.mjs', 200, 'end-to-end'],
  ];
  for (const [filename, maximum, layer] of layers) {
    const result = runLint(filename, sizePolicySource(maximum));
    assert.equal(result.status, 1, `${layer} over-budget case must fail lint.`);
    const messages = JSON.parse(result.stdout).flatMap((file) => file.messages);
    assert.deepEqual(
      messages.map((message) => message.ruleId),
      ['max-lines-per-function'],
      `${layer} under-budget case must pass; only the oversized case should fail.`,
    );
  }
});

for (const relative of [
  '../package.json',
  '../artifacts/glyph/package.json',
  '../artifacts/api-server/package.json',
]) {
  test(`${relative}: failed preflight prevents the artifact build`, async (t) => {
    const directory = await mkdtemp(join(tmpdir(), 'glyph-gate-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const executable = join(directory, 'pnpm');
    const marker = join(directory, 'built');
    await writeFile(
      executable,
      `#!/bin/sh\ncase "$*" in *check*) exit 23;; esac\n touch "${marker}"\n`,
    );
    await chmod(executable, 0o755);
    const { scripts } = JSON.parse(
      await readFile(new URL(relative, import.meta.url), 'utf8'),
    );
    const result = spawnSync('sh', ['-c', scripts.build], {
      env: { ...process.env, PATH: `${directory}:${process.env.PATH}` },
      encoding: 'utf8',
      timeout: 5_000,
    });
    assert.equal(
      result.status,
      23,
      'Build must propagate the failed preflight exit code.',
    );
    await assert.rejects(access(marker), { code: 'ENOENT' });
  });
}

test('coverage gate actually rejects an uncovered branch in a negative control', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'glyph-coverage-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const subject = join(directory, 'subject.mjs');
  const scenario = join(directory, 'scenario.test.mjs');
  await writeFile(
    subject,
    'export function outcome(x) {\n if (x) return true;\n return false;\n}\n',
  );
  await writeFile(
    scenario,
    "import test from 'node:test';\nimport {outcome} from './subject.mjs';\ntest('positive branch only',()=>outcome(true));\n",
  );
  // A fresh CLI must not inherit Node's internal "already a test worker" flag.
  // Otherwise --test silently skips discovery and returns a false green.
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const result = spawnSync(
    process.execPath,
    [
      '--test',
      '--experimental-test-coverage',
      '--test-coverage-branches=100',
      `--test-coverage-include=${subject}`,
      scenario,
    ],
    { encoding: 'utf8', timeout: 10_000, env },
  );
  assert.notEqual(
    result.status,
    0,
    'An uncovered branch must not pass a 100% branch threshold.',
  );
  assert.match(
    result.stdout + result.stderr,
    /coverage.*(threshold|less than)|branch.*coverage/i,
  );
});
