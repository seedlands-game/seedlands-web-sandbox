import type { Pool } from 'pg';

export async function setupWorkspaceSchema(pool: Pool, schemaSql: string): Promise<void> {
  await pool.query(`CREATE SCHEMA IF NOT EXISTS ${schemaSql}`);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS ${schemaSql}.workspace_state (
      namespace text PRIMARY KEY, binding jsonb NOT NULL, current_window_id text NOT NULL,
      memory_revision integer NOT NULL, next_journal_seq bigint NOT NULL DEFAULT 1,
      received_through bigint NOT NULL DEFAULT 0, included_through bigint NOT NULL DEFAULT 0,
      compacted_through bigint NOT NULL DEFAULT 0, cognition_suspended boolean NOT NULL DEFAULT false,
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE IF NOT EXISTS ${schemaSql}.documents (
      namespace text NOT NULL, path text NOT NULL, revision integer NOT NULL, content text NOT NULL,
      utf8_bytes integer NOT NULL, content_hash text NOT NULL, schema_version integer NOT NULL,
      template_version text NOT NULL, writer_role text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(), published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (namespace, path, revision)
    );
    CREATE TABLE IF NOT EXISTS ${schemaSql}.windows (
      namespace text NOT NULL, window_id text NOT NULL,
      status text NOT NULL CHECK (status IN ('active', 'frozen', 'sealed')),
      memory_revision integer NOT NULL, starts_after_journal_seq bigint NOT NULL,
      frozen_through_journal_seq bigint, frozen_through_event_cursor bigint,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(), sealed_at timestamptz,
      PRIMARY KEY (namespace, window_id)
    );
    CREATE TABLE IF NOT EXISTS ${schemaSql}.journal (
      namespace text NOT NULL, seq bigint NOT NULL, idempotency_key text NOT NULL,
      message_id text NOT NULL, window_id text NOT NULL, message jsonb NOT NULL,
      content_hash text NOT NULL, world_event_range jsonb,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (namespace, seq), UNIQUE (namespace, idempotency_key)
    );
    CREATE TABLE IF NOT EXISTS ${schemaSql}.world_events (
      namespace text NOT NULL, event_id text NOT NULL, cursor bigint NOT NULL, payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (namespace, event_id), UNIQUE (namespace, cursor)
    );
    CREATE TABLE IF NOT EXISTS ${schemaSql}.event_pages (
      namespace text NOT NULL, page_id text NOT NULL, coverage jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (namespace, page_id)
    );
    CREATE TABLE IF NOT EXISTS ${schemaSql}.runtime_metadata (
      namespace text PRIMARY KEY REFERENCES ${schemaSql}.workspace_state(namespace),
      revision integer NOT NULL DEFAULT 1, snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
      logical_rounds bigint NOT NULL DEFAULT 0, compactions bigint NOT NULL DEFAULT 0,
      updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE IF NOT EXISTS ${schemaSql}.immutable_blobs (
      content_hash text PRIMARY KEY, payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp()
    );
    CREATE TABLE IF NOT EXISTS ${schemaSql}.request_manifests (
      namespace text NOT NULL, request_id text NOT NULL,
      logical_model text NOT NULL CHECK (logical_model IN ('flash', 'pro')),
      through_journal_seq bigint NOT NULL,
      request_payload_ref text NOT NULL REFERENCES ${schemaSql}.immutable_blobs(content_hash),
      prefix_ref text NOT NULL REFERENCES ${schemaSql}.immutable_blobs(content_hash),
      tool_schema_ref text NOT NULL REFERENCES ${schemaSql}.immutable_blobs(content_hash),
      tool_schema_revision text NOT NULL, model_configuration_revision text NOT NULL,
      gateway_audit_ref text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
      PRIMARY KEY (namespace, request_id)
    );
    CREATE TABLE IF NOT EXISTS ${schemaSql}.request_receipts (
      namespace text NOT NULL, request_id text NOT NULL, outcome jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY (namespace, request_id)
    );
    CREATE TABLE IF NOT EXISTS ${schemaSql}.compaction_commits (
      namespace text NOT NULL, commit_id text NOT NULL, frozen_window_id text NOT NULL,
      through_journal_seq bigint NOT NULL, through_event_cursor bigint NOT NULL,
      old_memory_revision integer NOT NULL, new_memory_revision integer NOT NULL,
      next_window_id text NOT NULL, sources jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY (namespace, commit_id),
      UNIQUE (namespace, frozen_window_id)
    );
  `);
}
