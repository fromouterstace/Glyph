import { fork } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';

export async function waitUntil(check, budgetMs = 5_000) {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await sleep(20);
  }
  throw new Error('Process fixture condition timed out');
}

export async function startProcess(schema, graceMs = 5_000) {
  if (!/^glyph_test_[a-f0-9]{32}$/.test(schema))
    throw new Error('Unsafe schema');
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    PGOPTIONS: `-c search_path=${schema}`,
    PGAPPNAME: `${schema}_worker`,
    GLYPH_TEST_GRACE_MS: String(graceMs),
  };
  delete env.NODE_TEST_CONTEXT;
  const child = fork(
    fileURLToPath(new URL('./process-worker.mjs', import.meta.url)),
    {
      execArgv: ['--import', import.meta.resolve('tsx')],
      env,
      silent: true,
    },
  );
  // Drain but never print process output that could contain private environment data.
  child.stdout.resume();
  child.stderr.resume();
  const exit = once(child, 'exit');
  const message = (event) =>
    new Promise((resolve, reject) => {
      const deadline = setTimeout(() => {
        child.off('message', receive);
        reject(new Error(`Process fixture did not emit ${event}`));
      }, 10_000);
      const receive = (value) => {
        if (value.event !== event) return;
        clearTimeout(deadline);
        child.off('message', receive);
        resolve(value);
      };
      child.on('message', receive);
    });
  try {
    const listening = await Promise.race([
      message('listening'),
      exit.then(() => {
        throw new Error('Process fixture exited during startup');
      }),
    ]);
    return {
      child,
      exit,
      message,
      base: `http://127.0.0.1:${listening.port}`,
      applicationName: env.PGAPPNAME,
      async command(action, id) {
        const result = message('command');
        child.send({ action, id });
        return result;
      },
      async stop() {
        if (child.exitCode === null && child.signalCode === null)
          child.kill('SIGKILL');
        await exit;
      },
    };
  } catch (error) {
    child.kill('SIGKILL');
    await exit;
    throw error;
  }
}
