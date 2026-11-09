CREATE TABLE glyph_database_approvals (
  id text PRIMARY KEY NOT NULL,
  operation text NOT NULL,
  target text NOT NULL,
  plan_sha256 text NOT NULL,
  reason text NOT NULL,
  digest text NOT NULL,
  environment text NOT NULL,
  requested_by text NOT NULL,
  created_at timestamp with time zone NOT NULL,
  expires_at timestamp with time zone NOT NULL,
  first_user_id text,
  first_approved_at timestamp with time zone,
  second_user_id text,
  second_approved_at timestamp with time zone,
  revoked_at timestamp with time zone,
  revoked_by text,
  consumed_at timestamp with time zone,
  consumed_by text,
  CONSTRAINT glyph_database_approvals_operation_check CHECK (operation in ('delete_rows', 'truncate_table', 'drop_object', 'change_privileges')),
  CONSTRAINT glyph_database_approvals_environment_check CHECK (environment in ('development', 'production')),
  CONSTRAINT glyph_database_approvals_digest_check CHECK (digest ~ '^[a-f0-9]{64}$' and plan_sha256 ~ '^[a-f0-9]{64}$'),
  CONSTRAINT glyph_database_approvals_identity_check CHECK (
    (first_user_id is null) = (first_approved_at is null)
    and (second_user_id is null) = (second_approved_at is null)
    and (revoked_at is null) = (revoked_by is null)
    and (consumed_at is null) = (consumed_by is null)
    and (first_user_id is null or second_user_id is null or first_user_id <> second_user_id)),
  CONSTRAINT glyph_database_approvals_lifetime_check CHECK (expires_at > created_at and expires_at <= created_at + interval '1 hour'),
  CONSTRAINT glyph_database_approvals_input_check CHECK (target ~ '^[a-zA-Z0-9_.:-]{1,200}$' and length(trim(reason)) between 10 and 2000),
  CONSTRAINT glyph_database_approvals_signing_time_check CHECK (
    (first_approved_at is null or (first_approved_at >= created_at and first_approved_at < expires_at))
    and (second_approved_at is null or (second_approved_at >= created_at and second_approved_at < expires_at))),
  CONSTRAINT glyph_database_approvals_consumption_check CHECK (consumed_at is null or (
    first_approved_at is not null and second_approved_at is not null
    and revoked_at is null and consumed_at < expires_at
    and consumed_by in (first_user_id, second_user_id)))
);
CREATE INDEX glyph_database_approvals_created_idx ON glyph_database_approvals (created_at, id);
