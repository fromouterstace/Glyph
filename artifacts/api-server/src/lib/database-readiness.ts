interface Connection {
  query(options: { text: string; query_timeout: number }): Promise<unknown>;
  release(destroy?: boolean): void;
}

interface ProbeResult {
  rows: unknown[];
}

// Parse critical relations without scanning rows or exposing account data.
const probeSql = `SELECT m.id, m.owner_id, m.recipient_email, m.recipient_name,
  m.to_emails, m.cc_emails, m.bcc_emails, m.subject, m.body, m.body_html,
  m.attachments, m.track_opens, m.track_clicks, m.status, m.pixel_token,
  m.gmail_id, m.rfc_message_id, m.delivery_source, m.native_compose_key,
  m.created_at, m.sent_at, m.archived_at,
  e.id, e.message_id, e.type, e.url, e.automated, e.source, e.read, e.fingerprint, e.occurred_at,
  l.id, l.message_id, l.token, l.url, l.retired_at,
  s.id, s.owner_id, s.event_type, s.session_fingerprint, s.occurred_at,
  g.owner_id, g.id, g.email, g.generation, g.reply_identity, g.encrypted_tokens, g.updated_at,
  o.state_hash, o.owner_id, o.session_hash, o.origin, o.encrypted_verifier, o.claimed_at, o.expires_at,
  a.id, a.owner_id, a.name, a.size, a.content_type, a.object_path, a.generation, a.created_at, a.retired_at,
  pref.owner_id, pref.email_alerts, pref.email_alerts_since, pref.alert_mailbox,
  pref.notify_opens, pref.notify_clicks, pref.notify_replies,
  pref.default_track_opens, pref.default_track_clicks, pref.tracking_base_url,
  b.message_id, b.kind, b.window_bucket, b.window_count, b.day_bucket, b.day_count, b.updated_at,
  contacts.id, contacts.owner_id, contacts.first_name, contacts.last_name,
  contacts.email, contacts.email_suffix, contacts.created_at,
  imports.owner_id, imports.mailbox_identity, imports.page_token, imports.status, imports.last_synced_at,
  d.id, d.owner_id, d.message_id, d.event_id, d.type, d.consent_at,
  d.mailbox, d.status, d.rfc_message_id, d.gmail_id, d.created_at, d.updated_at
  FROM glyph_messages m LEFT JOIN glyph_events e ON false
  LEFT JOIN glyph_links l ON false LEFT JOIN glyph_system_events s ON false
  LEFT JOIN glyph_gmail_connections g ON false
  LEFT JOIN glyph_gmail_oauth_states o ON false
  LEFT JOIN glyph_attachments a ON false
  LEFT JOIN glyph_settings pref ON false
  LEFT JOIN glyph_tracking_budgets b ON false
  LEFT JOIN glyph_contacts contacts ON false
  LEFT JOIN glyph_label_imports imports ON false
  LEFT JOIN glyph_deliveries d ON false LIMIT 0`;

// A schema can contain every required column and still have lost the database
// constraints that protect idempotency and prevent orphan activity. Inspect
// PostgreSQL catalogs only; never expose constraint names/details publicly.
// Delivery SQL and Drizzle fixtures use different generated constraint names;
// check those key columns and reference semantics instead of name aliases.
const integritySql = `SELECT required.name FROM (VALUES
  ('primary', 'glyph_messages_pkey', 'glyph_messages', '', ''),
  ('primary', 'glyph_contacts_pkey', 'glyph_contacts', '', ''),
  ('primary', 'glyph_label_imports_pkey', 'glyph_label_imports', '', ''),
  ('index', 'glyph_contacts_owner_email_idx', 'glyph_contacts', '', ''),
  ('primary', 'glyph_events_pkey', 'glyph_events', '', ''),
  ('primary', 'glyph_links_pkey', 'glyph_links', '', ''),
  ('primary', 'glyph_settings_pkey', 'glyph_settings', '', ''),
  ('primary', 'glyph_system_events_pkey', 'glyph_system_events', '', ''),
  ('primary', 'glyph_attachments_pkey', 'glyph_attachments', '', ''),
  ('primary', 'glyph_gmail_connections_pkey', 'glyph_gmail_connections', '', ''),
  ('primary', 'glyph_gmail_oauth_states_pkey', 'glyph_gmail_oauth_states', '', ''),
  ('primary', 'glyph_deliveries_pkey', 'glyph_deliveries', '', ''),
  ('primary', 'glyph_tracking_budgets_message_id_kind_pk', 'glyph_tracking_budgets', '', ''),
  ('index', 'glyph_messages_pixel_token_unique', 'glyph_messages', '', ''),
  ('index', 'glyph_events_fingerprint_unique', 'glyph_events', '', ''),
  ('index', 'glyph_links_token_unique', 'glyph_links', '', ''),
  ('index', 'glyph_native_compose_idx', 'glyph_messages', '', ''),
  ('index', 'glyph_gmail_connections_email_idx', 'glyph_gmail_connections', '', ''),
  ('unique_columns', 'glyph_delivery_signal_idx', 'glyph_deliveries', 'message_id,type', ''),
  ('unique_columns', 'glyph_deliveries_rfc_message_id_key', 'glyph_deliveries', 'rfc_message_id', ''),
  ('foreign', 'glyph_events_message_id_glyph_messages_id_fk', 'glyph_events', 'c', 'glyph_messages'),
  ('foreign', 'glyph_links_message_id_glyph_messages_id_fk', 'glyph_links', 'c', 'glyph_messages'),
  ('foreign', 'glyph_tracking_budgets_message_id_glyph_messages_id_fk', 'glyph_tracking_budgets', 'c', 'glyph_messages'),
  ('foreign_column', 'glyph_deliveries_message_id_fkey', 'glyph_deliveries', 'message_id', 'glyph_messages'),
  ('foreign_column', 'glyph_deliveries_event_id_fkey', 'glyph_deliveries', 'event_id', 'glyph_events'),
  ('check', 'glyph_tracking_budgets_kind_check', 'glyph_tracking_budgets', '', ''),
  ('check', 'glyph_tracking_budgets_counts_check', 'glyph_tracking_budgets', '', '')
) AS required(kind, name, table_name, expected, reference_table)
WHERE CASE required.kind
  WHEN 'primary' THEN NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class tbl ON tbl.oid = c.conrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    JOIN pg_index i ON i.indexrelid = c.conindid
    WHERE ns.nspname = current_schema()
      AND c.conname = required.name
      AND tbl.relname = required.table_name
      AND c.contype = 'p' AND c.convalidated
      AND i.indisvalid AND i.indisready AND i.indisprimary
  )
  WHEN 'index' THEN NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class idx ON idx.oid = i.indexrelid
    JOIN pg_class tbl ON tbl.oid = i.indrelid
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
      AND ref.relname = required.reference_table
      AND ref.relnamespace = tbl.relnamespace
      AND c.contype = 'f'
      AND c.confdeltype = required.expected
      AND c.convalidated
  )
  WHEN 'unique_columns' THEN NOT EXISTS (
    SELECT 1 FROM pg_index i
    JOIN pg_class tbl ON tbl.oid = i.indrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    WHERE ns.nspname = current_schema()
      AND tbl.relname = required.table_name
      AND i.indisvalid AND i.indisready AND i.indisunique
      AND i.indpred IS NULL AND i.indexprs IS NULL
      AND ARRAY(
        SELECT a.attname::text
        FROM unnest(i.indkey::smallint[]) WITH ORDINALITY AS key(attnum, position)
        JOIN pg_attribute a ON a.attrelid = tbl.oid AND a.attnum = key.attnum
        WHERE key.position <= i.indnkeyatts
        ORDER BY key.position
      ) = string_to_array(required.expected, ',')
  )
  WHEN 'foreign_column' THEN NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class tbl ON tbl.oid = c.conrelid
    JOIN pg_namespace ns ON ns.oid = tbl.relnamespace
    JOIN pg_class ref ON ref.oid = c.confrelid
    JOIN pg_attribute local_column ON local_column.attrelid = tbl.oid
      AND local_column.attname = required.expected AND NOT local_column.attisdropped
    JOIN pg_attribute remote_column ON remote_column.attrelid = ref.oid
      AND remote_column.attname = 'id' AND NOT remote_column.attisdropped
    WHERE ns.nspname = current_schema()
      AND tbl.relname = required.table_name
      AND ref.relname = required.reference_table
      AND ref.relnamespace = tbl.relnamespace
      AND c.contype = 'f' AND c.confdeltype = 'c' AND c.convalidated
      AND c.conkey = ARRAY[local_column.attnum]
      AND c.confkey = ARRAY[remote_column.attnum]
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
