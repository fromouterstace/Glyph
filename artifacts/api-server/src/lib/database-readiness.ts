interface Connection {
  query(options: { text: string; query_timeout: number }): Promise<unknown>;
  release(destroy?: boolean): void;
}

// Parse critical relations without scanning rows or exposing account data.
const probeSql = `SELECT m.id, m.body_html, m.attachments, e.id, l.id,
  a.id, a.owner_id, a.object_path, a.generation, a.size, a.content_type
  FROM glyph_messages m LEFT JOIN glyph_events e ON false
  LEFT JOIN glyph_links l ON false LEFT JOIN glyph_attachments a ON false LIMIT 0`;

export function createReadinessProbe(
  connect: () => Promise<Connection>,
  { timeoutMs = 1_000, cacheMs = 1_000, now = Date.now } = {},
) {
  let cached = { ready: false, until: 0 };
  let pending: Promise<boolean> | undefined;
  let workPending = false;
  const run = async (): Promise<boolean> => {
    let expired = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = async () => {
      const client = await connect();
      try {
        if (expired) return false;
        await client.query({ text: probeSql, query_timeout: timeoutMs });
        return !expired;
      } finally {
        client.release(expired);
      }
    };
    workPending = true;
    const operation = work()
      .catch(() => false)
      .finally(() => {
        workPending = false;
      });
    try {
      return await Promise.race([
        operation,
        new Promise<boolean>((resolve) => {
          timer = setTimeout(() => {
            expired = true;
            resolve(false);
          }, timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
  return (): Promise<boolean> => {
    if (pending) return pending;
    // A timed-out connect may still be queued in the application pool. Do not
    // accumulate one more waiter every probe interval during a database outage.
    if (workPending) return Promise.resolve(false);
    if (now() < cached.until) return Promise.resolve(cached.ready);
    pending = run()
      .then((ready) => {
        cached = { ready, until: now() + cacheMs };
        return ready;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };
}
