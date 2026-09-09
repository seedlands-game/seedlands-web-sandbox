import type { Pool, PoolClient } from 'pg';
import { createWorkspaceNamespace, normalizeWorkspaceBinding } from './namespace.js';
import { validatePortableWorkspace } from './portable.js';
import type { PortableWorkspace, PortableWorkspaceImport, WorkspaceBinding, WorkspaceTimelineScope } from './types.js';

const MAX_BATCH_WORKSPACES = 1_024;

type ValidatedImport = Readonly<{
  target: WorkspaceBinding;
  namespace: string;
  portable: PortableWorkspace;
}>;

async function validateBatch(
  scope: WorkspaceTimelineScope,
  entries: readonly PortableWorkspaceImport[],
): Promise<readonly ValidatedImport[]> {
  const trustedScope = normalizeWorkspaceBinding({ ...scope, actorId: 'scope', incarnation: 'scope' });
  if (entries.length > MAX_BATCH_WORKSPACES) throw new Error('portable workspace import batch exceeds limit');
  const candidates = entries.map((entry) => ({
    target: structuredClone(entry.target),
    portable: structuredClone(entry.portable),
  }));
  const namespaces = new Set<string>();
  const validated: ValidatedImport[] = [];
  for (const entry of candidates) {
    await validatePortableWorkspace(entry.portable);
    const target = normalizeWorkspaceBinding(entry.target);
    if (target.worldId !== trustedScope.worldId || target.timelineId !== trustedScope.timelineId)
      throw new Error('portable workspace import target is outside the locked timeline');
    const namespace = createWorkspaceNamespace(target);
    if (namespaces.has(namespace)) throw new Error('portable workspace import target is duplicated');
    namespaces.add(namespace);
    validated.push({ target, namespace, portable: entry.portable });
  }
  return validated;
}

async function insertPortableRows(client: PoolClient, schema: string, entry: ValidatedImport): Promise<void> {
  const { namespace, portable, target } = entry;
  for (const row of portable.blobs)
    await client.query(
      `INSERT INTO ${schema}.immutable_blobs(content_hash,payload,created_at)
       VALUES ($1,$2::jsonb,$3) ON CONFLICT DO NOTHING`,
      [row.content_hash, JSON.stringify(row.payload), row.created_at],
    );
  const state = portable.state;
  await client.query(
    `INSERT INTO ${schema}.workspace_state
     (namespace,binding,current_window_id,memory_revision,next_journal_seq,received_through,included_through,compacted_through,cognition_suspended,updated_at)
     VALUES ($1,$2::jsonb,$3,$4,$5,$6,$7,$8,$9,clock_timestamp())`,
    [
      namespace,
      JSON.stringify(target),
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
    `INSERT INTO ${schema}.runtime_metadata(namespace,revision,snapshot,logical_rounds,compactions,updated_at)
     VALUES ($1,$2,$3::jsonb,$4,$5,clock_timestamp())`,
    [namespace, runtime.revision, JSON.stringify(runtime.snapshot), runtime.logical_rounds, runtime.compactions],
  );
  for (const row of portable.documents)
    await client.query(
      `INSERT INTO ${schema}.documents
       (namespace,path,revision,content,utf8_bytes,content_hash,schema_version,template_version,writer_role,created_at,published_at)
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
      `INSERT INTO ${schema}.windows
       (namespace,window_id,status,memory_revision,starts_after_journal_seq,frozen_through_journal_seq,frozen_through_event_cursor,created_at,sealed_at)
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
      `INSERT INTO ${schema}.journal
       (namespace,seq,idempotency_key,message_id,window_id,message,content_hash,world_event_range,created_at)
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
      `INSERT INTO ${schema}.world_events(namespace,event_id,cursor,payload,created_at)
       VALUES ($1,$2,$3,$4::jsonb,$5)`,
      [namespace, row.event_id, row.cursor, JSON.stringify(row.payload), row.created_at],
    );
  for (const row of portable.eventPages)
    await client.query(
      `INSERT INTO ${schema}.event_pages(namespace,page_id,coverage,created_at) VALUES ($1,$2,$3::jsonb,$4)`,
      [namespace, row.page_id, JSON.stringify(row.coverage), row.created_at],
    );
  for (const row of portable.manifests)
    await client.query(
      `INSERT INTO ${schema}.request_manifests
       (namespace,request_id,logical_model,through_journal_seq,request_payload_ref,prefix_ref,tool_schema_ref,tool_schema_revision,model_configuration_revision,gateway_audit_ref,created_at)
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
      `INSERT INTO ${schema}.request_receipts(namespace,request_id,outcome,created_at)
       VALUES ($1,$2,$3::jsonb,$4)`,
      [namespace, row.request_id, JSON.stringify(row.outcome), row.created_at],
    );
  for (const row of portable.compactionCommits)
    await client.query(
      `INSERT INTO ${schema}.compaction_commits
       (namespace,commit_id,frozen_window_id,through_journal_seq,through_event_cursor,old_memory_revision,new_memory_revision,next_window_id,sources,created_at)
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
}

export async function importPortableWorkspaceBatch(
  pool: Pool,
  schema: string,
  scope: WorkspaceTimelineScope,
  entries: readonly PortableWorkspaceImport[],
): Promise<void> {
  const validated = await validateBatch(scope, entries);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
      JSON.stringify(['seedlands-npc-workspace-import', scope.worldId, scope.timelineId]),
    ]);
    if (validated.length > 0) {
      const existing = await client.query<{ namespace: string }>(
        `SELECT namespace FROM ${schema}.workspace_state WHERE namespace=ANY($1::text[]) LIMIT 1`,
        [validated.map((entry) => entry.namespace)],
      );
      if (existing.rowCount) throw new Error('target workspace already exists');
    }
    for (const entry of validated) await insertPortableRows(client, schema, entry);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function importPortableWorkspace(
  pool: Pool,
  schema: string,
  target: WorkspaceBinding,
  portable: PortableWorkspace,
): Promise<void> {
  await importPortableWorkspaceBatch(pool, schema, { worldId: target.worldId, timelineId: target.timelineId }, [
    { target, portable },
  ]);
}
