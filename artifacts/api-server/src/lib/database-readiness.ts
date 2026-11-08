interface Connection {
  query(options: { text: string; query_timeout: number }): Promise<unknown>;
  release(destroy?: boolean): void;
}

interface ProbeResult {
  rows: unknown[];
}

// Parse critical relations without scanning rows or exposing account data.
const probeSql = `SELECT m.id, m.body_html, m.attachments, e.id, l.id,
  s.id, g.owner_id, g.encrypted_tokens, g.reply_identity, o.state_hash,
  a.id, a.owner_id, a.object_path, a.generation, a.size, a.content_type
  FROM glyph_messages m LEFT JOIN glyph_events e ON false
  LEFT JOIN glyph_links l ON false LEFT JOIN glyph_system_events s ON false
  LEFT JOIN glyph_gmail_connections g ON false
  LEFT JOIN glyph_gmail_oauth_states o ON false
  LEFT JOIN glyph_attachments a ON false LIMIT 0`;

// A schema can contain every required column and still have lost the database
// constraints that protect idempotency and prevent orphan activity. Inspect
// PostgreSQL catalogs only; never expose constraint names/details publicly.
const integritySql = `SELECT required.name FROM (VALUES
  ('index', 'glyph_messages_pixel_token_unique', 'glyph_messages', ''),
  ('index', 'glyph_events_fingerprint_unique', 'glyph_events', ''),
  ('index', 'glyph_links_token_unique', 'glyph_links', ''),
  ('index', 'glyph_native_compose_idx', 'glyph_messages', ''),
  ('index', 'glyph_gmail_connections_email_idx', 'glyph_gmail_connections', ''),
  ('foreign', 'glyph_events_message_id_glyph_messages_id_fk', 'glyph_events', 'c'),
  ('foreign', 'glyph_links_message_id_glyph_messages_id_fk', 'glyph_links', 'c'),
  ('foreign', 'glyph_tracking_budgets_message_id_glyph_messages_id_fk', 'glyph_tracking_budgets', 'c'),
  ('check', 'glyph_tracking_budgets_kind_check', 'glyph_tracking_budgets', ''),
  ('check', 'glyph_tracking_budgets_counts_check', 'glyph_tracking_budgets', '')
) AS required(kind, name, table_name, expected)
WHERE CASE required.kind
  WHEN 'index' THEN NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_namespace ns ON ns.oid = idx.relnamespace
    WHERE ns.nspname = current_schema()
      AND idx.relname = required.name
      AND tbl.relname = required.table_name
      AND i.indisvalid AND i.indisready AND i.indisunique
      AND i.indpred IS NULL AND i.indexprs IS NULL
  )
  WHEN 'foreign' THEN NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class tbl ON tbl.oid = c.conrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    JOIN pg_class ref ON ref.oid = c.confrelid
    WHERE ns.nspname = current_schema()
      AND c.conname = required.name
      AND tbl.relname = required.table_name
      AND ref.relname = 'glyph_messages'
      AND c.contype = 'f'
      AND c.confdeltype = required.expected
      AND c.convalidated
  )
  WHEN 'check' THEN NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class tbl ON tbl.oid = c.conrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    WHERE ns.nspname = current_schema()
      AND c.conname = required.name
      AND tbl.relname = required.table_name
      AND c.contype = 'c'
      AND c.convalidated
  )
END
LIMIT 1`;

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
        if (expired) return false;
        const integrity = (await client.query({
          text: integritySql,
          query_timeout: timeoutMs,
        })) as ProbeResult;
        return !expired && integrity.rows.length === 0;
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
