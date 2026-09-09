import type { Pool } from 'pg';
import { createWorkspaceNamespace, normalizeWorkspaceBinding } from './namespace.js';
import type { PortableWorkspace, WorkspaceBinding } from './types.js';

function jsonValue(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

async function hashPortableValue(value: unknown): Promise<string> {
  const normalized = JSON.parse(JSON.stringify(value)) as unknown;
  const canonicalJson = (entry: unknown): string => {
    if (Array.isArray(entry)) return `[${entry.map(canonicalJson).join(',')}]`;
    if (entry && typeof entry === 'object') {
      const object = entry as Record<string, unknown>;
      return `{${Object.keys(object)
        .sort()
        .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
        .join(',')}}`;
    }
    return JSON.stringify(entry);
  };
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalJson(normalized)));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function validatePortableWorkspace(portable: PortableWorkspace): Promise<void> {
  if (portable.format !== 'seedlands-npc-workspace' || portable.schemaVersion !== 1)
    throw new Error('unsupported portable workspace');
  const sourceNamespace = createWorkspaceNamespace(portable.binding);
  const namespacedRows = [
    portable.state,
    portable.runtimeMetadata,
    ...portable.documents,
    ...portable.journal,
    ...portable.events,
    ...portable.eventPages,
    ...portable.windows,
    ...portable.manifests,
    ...portable.receipts,
    ...portable.compactionCommits,
  ];
  if (namespacedRows.some((row) => row.namespace !== sourceNamespace))
    throw new Error('portable workspace namespace does not match its trusted binding');
  for (const document of portable.documents)
    if ((await hashPortableValue(document.content)) !== document.content_hash)
      throw new Error('portable workspace document checksum mismatch');
  for (const journal of portable.journal)
    if ((await hashPortableValue(journal.message)) !== journal.content_hash)
      throw new Error('portable workspace journal checksum mismatch');
  const blobRefs = new Set<string>();
  for (const blob of portable.blobs) {
    if ((await hashPortableValue(blob.payload)) !== blob.content_hash)
      throw new Error('portable workspace immutable blob checksum mismatch');
    blobRefs.add(String(blob.content_hash));
  }
  for (const manifest of portable.manifests)
    for (const field of ['request_payload_ref', 'prefix_ref', 'tool_schema_ref'] as const)
      if (!blobRefs.has(String(manifest[field]))) throw new Error('portable workspace manifest has a missing blob');
}

export async function exportPortableWorkspace(
  pool: Pool,
  schemaSql: string,
  binding: WorkspaceBinding,
): Promise<PortableWorkspace> {
  const namespace = createWorkspaceNamespace(binding);
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const tables = [
      'workspace_state',
      'documents',
      'journal',
      'world_events',
      'event_pages',
      'runtime_metadata',
      'windows',
      'request_manifests',
      'request_receipts',
      'compaction_commits',
    ] as const;
    const rows = Object.create(null) as Record<(typeof tables)[number], readonly Record<string, unknown>[]>;
    for (const table of tables) {
      const result = await client.query(`SELECT * FROM ${schemaSql}.${table} WHERE namespace=$1 ORDER BY 1`, [
        namespace,
      ]);
      rows[table] = result.rows.map(jsonValue);
    }
    const state = rows.workspace_state[0];
    if (!state) throw new Error('workspace is not initialized');
    const refs = rows.request_manifests.flatMap((row) => [
      String(row.request_payload_ref),
      String(row.prefix_ref),
      String(row.tool_schema_ref),
    ]);
    const blobs =
      refs.length === 0
        ? []
        : (
            await client.query(
              `SELECT * FROM ${schemaSql}.immutable_blobs WHERE content_hash = ANY($1::text[]) ORDER BY content_hash`,
              [refs],
            )
          ).rows.map(jsonValue);
    const portable: PortableWorkspace = {
      format: 'seedlands-npc-workspace',
      schemaVersion: 1,
      exportedAt: new Date().toISOString(),
      binding: normalizeWorkspaceBinding(binding),
      state,
      documents: rows.documents,
      journal: rows.journal,
      events: rows.world_events,
      eventPages: rows.event_pages,
      runtimeMetadata: rows.runtime_metadata[0] ?? {},
      windows: rows.windows,
      manifests: rows.request_manifests,
      receipts: rows.request_receipts,
      compactionCommits: rows.compaction_commits,
      blobs,
    };
    await client.query('COMMIT');
    return portable;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function importPortableWorkspace(
  pool: Pool,
  schemaSql: string,
  target: WorkspaceBinding,
  portable: PortableWorkspace,
): Promise<void> {
  await validatePortableWorkspace(portable);
  const trusted = normalizeWorkspaceBinding(target);
  const namespace = createWorkspaceNamespace(trusted);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    if ((await client.query(`SELECT 1 FROM ${schemaSql}.workspace_state WHERE namespace=$1`, [namespace])).rowCount)
      throw new Error('target workspace already exists');
    for (const row of portable.blobs)
      await client.query(
        `INSERT INTO ${schemaSql}.immutable_blobs(content_hash,payload,created_at) VALUES ($1,$2::jsonb,$3) ON CONFLICT DO NOTHING`,
        [row.content_hash, JSON.stringify(row.payload), row.created_at],
      );
    const state = portable.state;
    await client.query(
      `INSERT INTO ${schemaSql}.workspace_state
       (namespace,binding,current_window_id,memory_revision,next_journal_seq,received_through,included_through,compacted_through,cognition_suspended,updated_at)
       VALUES ($1,$2::jsonb,$3,$4,$5,$6,$7,$8,$9,clock_timestamp())`,
      [
        namespace,
        JSON.stringify(trusted),
        state.current_window_id,
        state.memory_revision,
        state.next_journal_seq,
        state.received_through,
        state.included_through,
        state.compacted_through,
        state.cognition_suspended,
      ],
    );
    const runtime = portable.runtimeMetadata;
    await client.query(
      `INSERT INTO ${schemaSql}.runtime_metadata(namespace,revision,snapshot,logical_rounds,compactions,updated_at)
       VALUES ($1,$2,$3::jsonb,$4,$5,clock_timestamp())`,
      [namespace, runtime.revision, JSON.stringify(runtime.snapshot), runtime.logical_rounds, runtime.compactions],
    );
    for (const row of portable.documents)
      await client.query(
        `INSERT INTO ${schemaSql}.documents(namespace,path,revision,content,utf8_bytes,content_hash,schema_version,template_version,writer_role,created_at,published_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'system-import',$9,$10)`,
        [
          namespace,
          row.path,
          row.revision,
          row.content,
          row.utf8_bytes,
          row.content_hash,
          row.schema_version,
          row.template_version,
          row.created_at,
          row.published_at,
        ],
      );
    for (const row of portable.windows)
      await client.query(
        `INSERT INTO ${schemaSql}.windows(namespace,window_id,status,memory_revision,starts_after_journal_seq,frozen_through_journal_seq,frozen_through_event_cursor,created_at,sealed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [
          namespace,
          row.window_id,
          row.status,
          row.memory_revision,
          row.starts_after_journal_seq,
          row.frozen_through_journal_seq,
          row.frozen_through_event_cursor,
          row.created_at,
          row.sealed_at,
        ],
      );
    for (const row of portable.journal)
      await client.query(
        `INSERT INTO ${schemaSql}.journal(namespace,seq,idempotency_key,message_id,window_id,message,content_hash,world_event_range,created_at)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb,$9)`,
        [
          namespace,
          row.seq,
          row.idempotency_key,
          row.message_id,
          row.window_id,
          JSON.stringify(row.message),
          row.content_hash,
          row.world_event_range ? JSON.stringify(row.world_event_range) : null,
          row.created_at,
        ],
      );
    for (const row of portable.events)
      await client.query(
        `INSERT INTO ${schemaSql}.world_events(namespace,event_id,cursor,payload,created_at) VALUES ($1,$2,$3,$4::jsonb,$5)`,
        [namespace, row.event_id, row.cursor, JSON.stringify(row.payload), row.created_at],
      );
    for (const row of portable.eventPages)
      await client.query(
        `INSERT INTO ${schemaSql}.event_pages(namespace,page_id,coverage,created_at) VALUES ($1,$2,$3::jsonb,$4)`,
        [namespace, row.page_id, JSON.stringify(row.coverage), row.created_at],
      );
    for (const row of portable.manifests)
      await client.query(
        `INSERT INTO ${schemaSql}.request_manifests(namespace,request_id,logical_model,through_journal_seq,request_payload_ref,prefix_ref,tool_schema_ref,tool_schema_revision,model_configuration_revision,gateway_audit_ref,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          namespace,
          row.request_id,
          row.logical_model,
          row.through_journal_seq,
          row.request_payload_ref,
          row.prefix_ref,
          row.tool_schema_ref,
          row.tool_schema_revision,
          row.model_configuration_revision,
          row.gateway_audit_ref,
          row.created_at,
        ],
      );
    for (const row of portable.receipts)
      await client.query(
        `INSERT INTO ${schemaSql}.request_receipts(namespace,request_id,outcome,created_at) VALUES ($1,$2,$3::jsonb,$4)`,
        [namespace, row.request_id, JSON.stringify(row.outcome), row.created_at],
      );
    for (const row of portable.compactionCommits)
      await client.query(
        `INSERT INTO ${schemaSql}.compaction_commits(namespace,commit_id,frozen_window_id,through_journal_seq,through_event_cursor,old_memory_revision,new_memory_revision,next_window_id,sources,created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)`,
        [
          namespace,
          row.commit_id,
          row.frozen_window_id,
          row.through_journal_seq,
          row.through_event_cursor,
          row.old_memory_revision,
          row.new_memory_revision,
          row.next_window_id,
          JSON.stringify(row.sources),
          row.created_at,
        ],
      );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
