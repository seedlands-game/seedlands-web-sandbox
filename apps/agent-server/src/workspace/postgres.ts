import type { BaseMessage } from '@langchain/core/messages';
import { Pool, type PoolClient } from 'pg';
import { boundedInteger, canonicalJson, hashJson, integer, iso, jsonValue } from './codec.js';
import { createWorkspaceNamespace, normalizeWorkspaceBinding } from './namespace.js';
import { initializeWorkspace } from './initialization.js';
import { setupWorkspaceSchema } from './schema.js';
import { exportPortableWorkspace } from './portable.js';
import { importPortableWorkspace, importPortableWorkspaceBatch } from './portable-import.js';
import { freezeWorkspace, publishWorkspaceCompaction } from './compaction.js';
import { appendWorkspaceMessages, getWorkspaceJournal, restoreWorkspaceMessages } from './journal.js';
import {
  getWorkspaceRuntimeMetadata,
  readWorkspaceEventCoverage,
  receiveWorkspaceEventPage,
  setWorkspaceRuntimeMetadata,
} from './runtime.js';
import {
  type CognitionRuntimeMetadata,
  type EventPageCoverage,
  type FrozenCompaction,
  type InitializeNpcInput,
  type JournalMessage,
  type JournalMessageInput,
  type MemoryDraft,
  type PortableWorkspace,
  type PortableWorkspaceImport,
  type ReceivedEventPage,
  type RequestManifestInput,
  type Watermarks,
  type WorkspaceBinding,
  type WorkspaceDocument,
  type WorkspaceEvent,
  type WorkspaceFilePath,
  type WorkspaceReaderRole,
  type WorkspaceTimelineScope,
} from './types.js';

const VISIBLE_PATHS: readonly WorkspaceFilePath[] = ['/AGENT.md', '/SOUL.md', '/MEMORY.md', '/behavior/current.json'];

type WorkspaceStateRow = {
  namespace: string;
  binding: WorkspaceBinding;
  current_window_id: string;
  memory_revision: number;
  next_journal_seq: string | number;
  received_through: string | number;
  included_through: string | number;
  compacted_through: string | number;
  cognition_suspended: boolean;
};

type ManifestRow = {
  logical_model: string;
  through_journal_seq: string | number;
  request_payload_ref: string;
  prefix_ref: string;
  tool_schema_ref: string;
  tool_schema_revision: string;
  model_configuration_revision: string;
  gateway_audit_ref: string | null;
};

function assertSchema(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/u.test(schema)) throw new Error('invalid PostgreSQL schema name');
  return `"${schema}"`;
}

function assertPath(path: string): asserts path is WorkspaceFilePath {
  if (!VISIBLE_PATHS.includes(path as WorkspaceFilePath)) throw new Error('workspace path is not visible');
}

export class PersistentNpcWorkspace {
  readonly pool: Pool;
  readonly schema: string;
  readonly schemaSql: string;

  constructor(pool: Pool, schema = 'npc_cognition') {
    this.pool = pool;
    this.schema = schema;
    this.schemaSql = assertSchema(schema);
  }

  static open(options: Readonly<{ connectionString: string; schema?: string }>): PersistentNpcWorkspace {
    if (!options.connectionString) throw new Error('connectionString is required');
    return new PersistentNpcWorkspace(new Pool({ connectionString: options.connectionString, max: 8 }), options.schema);
  }

  async setup(): Promise<void> {
    await setupWorkspaceSchema(this.pool, this.schemaSql);
  }

  async close(): Promise<void> {
    await this.pool.end();
  }

  private async lockedState(client: PoolClient, binding: WorkspaceBinding): Promise<WorkspaceStateRow> {
    const namespace = createWorkspaceNamespace(binding);
    const result = await client.query<WorkspaceStateRow>(
      `SELECT * FROM ${this.schemaSql}.workspace_state WHERE namespace = $1 FOR UPDATE`,
      [namespace],
    );
    const row = result.rows[0];
    if (!row) throw new Error('workspace is not initialized');
    return row;
  }

  async initializeNpc(binding: WorkspaceBinding, input: InitializeNpcInput): Promise<void> {
    await initializeWorkspace(this.pool, this.schemaSql, binding, input);
  }

  /** Trusted host-only enumeration for complete world exports; never registered as an Agent tool. */
  async listBindings(worldId: string, timelineId: string): Promise<readonly WorkspaceBinding[]> {
    normalizeWorkspaceBinding({ worldId, timelineId, actorId: 'scope', incarnation: 'scope' });
    const result = await this.pool.query<{ binding: WorkspaceBinding }>(
      `SELECT binding FROM ${this.schemaSql}.workspace_state
       WHERE binding->>'worldId'=$1 AND binding->>'timelineId'=$2
       ORDER BY namespace LIMIT 1025`,
      [worldId, timelineId],
    );
    if (result.rows.length > 1024) throw new Error('world workspace export exceeds resident history budget');
    return result.rows.map((row) => normalizeWorkspaceBinding(row.binding));
  }

  async listFiles(binding: WorkspaceBinding, _role: WorkspaceReaderRole): Promise<readonly WorkspaceFilePath[]> {
    await this.assertInitialized(binding);
    return VISIBLE_PATHS;
  }

  async readFile(binding: WorkspaceBinding, path: string, _role: WorkspaceReaderRole): Promise<WorkspaceDocument> {
    assertPath(path);
    const namespace = createWorkspaceNamespace(binding);
    const result = await this.pool.query(
      `SELECT d.* FROM ${this.schemaSql}.documents d
       JOIN ${this.schemaSql}.workspace_state s ON s.namespace = d.namespace
       WHERE d.namespace = $1 AND d.path = $2
         AND d.revision = CASE WHEN d.path = '/MEMORY.md' THEN s.memory_revision
           ELSE (SELECT max(d2.revision) FROM ${this.schemaSql}.documents d2 WHERE d2.namespace=d.namespace AND d2.path=d.path) END`,
      [namespace, path],
    );
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) throw new Error('workspace document does not exist');
    return {
      namespace,
      path,
      revision: Number(row.revision),
      content: String(row.content),
      utf8Bytes: Number(row.utf8_bytes),
      contentHash: String(row.content_hash),
      schemaVersion: Number(row.schema_version),
      templateVersion: String(row.template_version),
      writerRole: row.writer_role as WorkspaceDocument['writerRole'],
      createdAt: iso(row.created_at as Date | string),
      publishedAt: iso(row.published_at as Date | string),
    };
  }

  async projectBehavior(binding: WorkspaceBinding, expectedRevision: number, behavior: unknown): Promise<number> {
    const namespace = createWorkspaceNamespace(binding);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.lockedState(client, binding);
      const current = await client.query<{ revision: number }>(
        `SELECT max(revision)::integer AS revision FROM ${this.schemaSql}.documents WHERE namespace=$1 AND path='/behavior/current.json'`,
        [namespace],
      );
      if (current.rows[0]?.revision !== expectedRevision) throw new Error('behavior revision conflict');
      const revision = expectedRevision + 1;
      const content = JSON.stringify(behavior);
      await client.query(
        `INSERT INTO ${this.schemaSql}.documents
          (namespace,path,revision,content,utf8_bytes,content_hash,schema_version,template_version,writer_role)
         SELECT $1,'/behavior/current.json',$2,$3,$4,$5,1,template_version,'authority'
         FROM ${this.schemaSql}.documents WHERE namespace=$1 AND path='/behavior/current.json' AND revision=$6`,
        [namespace, revision, content, Buffer.byteLength(content, 'utf8'), await hashJson(content), expectedRevision],
      );
      await client.query('COMMIT');
      return revision;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async appendMessages(
    binding: WorkspaceBinding,
    entries: readonly JournalMessageInput[],
  ): Promise<readonly JournalMessage[]> {
    return appendWorkspaceMessages(this.pool, this.schemaSql, binding, entries);
  }

  async getJournal(
    binding: WorkspaceBinding,
    options: Readonly<{
      from?: number;
      through?: number;
      windowId?: string;
      limit?: number;
      maxUtf8Bytes?: number;
    }> = {},
  ): Promise<readonly JournalMessage[]> {
    return getWorkspaceJournal(this.pool, this.schemaSql, binding, options);
  }

  restoreMessages(messages: readonly JournalMessage[]): BaseMessage[] {
    return restoreWorkspaceMessages(messages);
  }

  async receiveEvents(binding: WorkspaceBinding, events: readonly WorkspaceEvent[]): Promise<Watermarks> {
    const watermarks = await this.getWatermarks(binding);
    const through = events.reduce((cursor, event) => Math.max(cursor, event.cursor), watermarks.receivedThrough);
    return this.receiveEventPage(binding, {
      pageId: `legacy:${watermarks.receivedThrough}:${through}`,
      coverage: {
        requestedAfter: watermarks.receivedThrough,
        through,
        returnedThrough: through,
        hasMore: false,
      },
      events,
    });
  }

  async receiveEventPage(binding: WorkspaceBinding, page: ReceivedEventPage): Promise<Watermarks> {
    return receiveWorkspaceEventPage(this.pool, this.schemaSql, binding, page);
  }

  async readEventCoverage(binding: WorkspaceBinding, after = 0): Promise<readonly EventPageCoverage[]> {
    return readWorkspaceEventCoverage(this.pool, this.schemaSql, binding, after);
  }

  async markIncluded(binding: WorkspaceBinding, through: number): Promise<Watermarks> {
    const namespace = createWorkspaceNamespace(binding);
    const result = await this.pool.query<WorkspaceStateRow>(
      `UPDATE ${this.schemaSql}.workspace_state
       SET included_through=$2,updated_at=clock_timestamp()
       WHERE namespace=$1 AND included_through <= $2 AND received_through >= $2
       RETURNING *`,
      [namespace, through],
    );
    const state = result.rows[0];
    if (!state) throw new Error('included watermark is stale or beyond received watermark');
    return {
      receivedThrough: integer(state.received_through),
      includedThrough: integer(state.included_through),
      compactedThrough: integer(state.compacted_through),
    };
  }

  async getWatermarks(binding: WorkspaceBinding): Promise<Watermarks> {
    const namespace = createWorkspaceNamespace(binding);
    const result = await this.pool.query<WorkspaceStateRow>(
      `SELECT * FROM ${this.schemaSql}.workspace_state WHERE namespace=$1`,
      [namespace],
    );
    const state = result.rows[0];
    if (!state) throw new Error('workspace is not initialized');
    return {
      receivedThrough: integer(state.received_through),
      includedThrough: integer(state.included_through),
      compactedThrough: integer(state.compacted_through),
    };
  }

  async getActiveWindow(binding: WorkspaceBinding): Promise<Readonly<{ windowId: string; memoryRevision: number }>> {
    const result = await this.pool.query<WorkspaceStateRow>(
      `SELECT * FROM ${this.schemaSql}.workspace_state WHERE namespace=$1`,
      [createWorkspaceNamespace(binding)],
    );
    const state = result.rows[0];
    if (!state) throw new Error('workspace is not initialized');
    return { windowId: state.current_window_id, memoryRevision: state.memory_revision };
  }

  async readRecentEvents(
    binding: WorkspaceBinding,
    options: Readonly<{ after?: number; limit?: number }> = {},
  ): Promise<
    Readonly<{
      events: readonly WorkspaceEvent[];
      coverage: readonly EventPageCoverage[];
      watermarks: Watermarks;
      hasMore: boolean;
    }>
  > {
    const limit = options.limit ?? 32;
    if (!Number.isInteger(limit) || limit < 1 || limit > 32)
      throw new Error('event page limit must be between 1 and 32');
    const watermarks = await this.getWatermarks(binding);
    const after = Math.max(options.after ?? watermarks.compactedThrough, watermarks.compactedThrough);
    const result = await this.pool.query<{
      event_id: string;
      cursor: string | number;
      payload: Readonly<Record<string, unknown>>;
    }>(
      `SELECT event_id,cursor,payload FROM ${this.schemaSql}.world_events
       WHERE namespace=$1 AND cursor > $2 AND cursor <= $3 ORDER BY cursor LIMIT $4`,
      [createWorkspaceNamespace(binding), after, watermarks.receivedThrough, limit + 1],
    );
    return {
      events: result.rows
        .slice(0, limit)
        .map((row) => ({ eventId: row.event_id, cursor: integer(row.cursor), payload: row.payload })),
      watermarks,
      hasMore: result.rows.length > limit,
      coverage: await this.readEventCoverage(binding, after),
    };
  }

  async recordRequestManifest(binding: WorkspaceBinding, input: RequestManifestInput): Promise<void> {
    if (!input.requestId || input.requestId.length > 256) throw new Error('request manifest id is invalid');
    boundedInteger(input.throughJournalSeq, 'request manifest journal boundary', 0, Number.MAX_SAFE_INTEGER);
    const namespace = createWorkspaceNamespace(binding);
    const requestRef = await hashJson(input.requestPayload);
    const prefixRef = await hashJson(input.systemPrefix);
    const toolRef = await hashJson(input.toolSchema);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.lockedState(client, binding);
      for (const [ref, payload] of [
        [requestRef, input.requestPayload],
        [prefixRef, input.systemPrefix],
        [toolRef, input.toolSchema],
      ] as const) {
        const blob = await client.query<{ payload: unknown }>(
          `INSERT INTO ${this.schemaSql}.immutable_blobs(content_hash,payload) VALUES ($1,$2::jsonb)
           ON CONFLICT (content_hash) DO UPDATE SET content_hash=EXCLUDED.content_hash RETURNING payload`,
          [ref, JSON.stringify(payload)],
        );
        if (canonicalJson(blob.rows[0]?.payload) !== canonicalJson(jsonValue(payload)))
          throw new Error('immutable blob hash payload conflict');
      }
      const recorded = await client.query<ManifestRow>(
        `INSERT INTO ${this.schemaSql}.request_manifests
          (namespace,request_id,logical_model,through_journal_seq,request_payload_ref,prefix_ref,tool_schema_ref,tool_schema_revision,model_configuration_revision,gateway_audit_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
         ON CONFLICT (namespace,request_id) DO UPDATE SET request_id=EXCLUDED.request_id
         RETURNING logical_model,through_journal_seq,request_payload_ref,prefix_ref,tool_schema_ref,
           tool_schema_revision,model_configuration_revision,gateway_audit_ref`,
        [
          namespace,
          input.requestId,
          input.logicalModel,
          input.throughJournalSeq,
          requestRef,
          prefixRef,
          toolRef,
          input.toolSchemaRevision,
          input.modelConfigurationRevision,
          input.gatewayAuditRef ?? null,
        ],
      );
      const row = recorded.rows[0];
      if (
        !row ||
        row.logical_model !== input.logicalModel ||
        integer(row.through_journal_seq) !== input.throughJournalSeq ||
        row.request_payload_ref !== requestRef ||
        row.prefix_ref !== prefixRef ||
        row.tool_schema_ref !== toolRef ||
        row.tool_schema_revision !== input.toolSchemaRevision ||
        row.model_configuration_revision !== input.modelConfigurationRevision ||
        row.gateway_audit_ref !== (input.gatewayAuditRef ?? null)
      )
        throw new Error('request manifest immutable evidence conflict');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async recordRequestReceipt(
    binding: WorkspaceBinding,
    requestId: string,
    outcome: Readonly<Record<string, unknown>>,
  ): Promise<void> {
    if (!requestId || requestId.length > 256) throw new Error('request receipt id is invalid');
    const namespace = createWorkspaceNamespace(binding);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await this.lockedState(client, binding);
      const recorded = await client.query<{ outcome: unknown }>(
        `INSERT INTO ${this.schemaSql}.request_receipts(namespace,request_id,outcome)
         VALUES ($1,$2,$3::jsonb)
         ON CONFLICT (namespace,request_id) DO UPDATE SET request_id=EXCLUDED.request_id RETURNING outcome`,
        [namespace, requestId, JSON.stringify(outcome)],
      );
      if (canonicalJson(recorded.rows[0]?.outcome) !== canonicalJson(jsonValue(outcome)))
        throw new Error('request receipt immutable outcome conflict');
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  /** Trusted pre-admission lookup. A terminal receipt makes the logical request id immutable. */
  async getRequestReceipt(
    binding: WorkspaceBinding,
    requestId: string,
  ): Promise<Readonly<Record<string, unknown>> | null> {
    if (!requestId || requestId.length > 256) throw new Error('request receipt id is invalid');
    const result = await this.pool.query<{ outcome: Readonly<Record<string, unknown>> | null }>(
      `SELECT r.outcome FROM ${this.schemaSql}.workspace_state s
       LEFT JOIN ${this.schemaSql}.request_receipts r ON r.namespace=s.namespace AND r.request_id=$2
       WHERE s.namespace=$1`,
      [createWorkspaceNamespace(binding), requestId],
    );
    if (!result.rows[0]) throw new Error('workspace is not initialized');
    return result.rows[0].outcome;
  }

  async freezeForCompaction(binding: WorkspaceBinding): Promise<FrozenCompaction> {
    return freezeWorkspace(
      this.pool,
      this.schemaSql,
      binding,
      () => this.readFile(binding, '/MEMORY.md', 'memory-editor'),
      (windowId, through) => this.getJournal(binding, { windowId, through }),
    );
  }

  async publishCompaction(
    binding: WorkspaceBinding,
    draft: MemoryDraft,
  ): Promise<Readonly<{ commitId: string; memoryRevision: number; windowId: string }>> {
    return publishWorkspaceCompaction(this.pool, this.schemaSql, binding, draft);
  }

  /**
   * Completes the failure side of freezeForCompaction. Soft failure reopens the exact frozen window;
   * hard failure keeps it frozen and blocks cognition until a successful publication creates a new window.
   */
  async markCompactionFailure(
    binding: WorkspaceBinding,
    hardLimitReached: boolean,
    frozenWindowId?: string,
  ): Promise<void> {
    const namespace = createWorkspaceNamespace(binding);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const state = await this.lockedState(client, binding);
      const expectedWindowId = frozenWindowId ?? state.current_window_id;
      if (state.current_window_id !== expectedWindowId) throw new Error('compaction failure window conflict');
      const window = await client.query<{ status: string }>(
        `SELECT status FROM ${this.schemaSql}.windows WHERE namespace=$1 AND window_id=$2 FOR UPDATE`,
        [namespace, expectedWindowId],
      );
      if (window.rows[0]?.status !== 'frozen') throw new Error('compaction failure requires the current frozen window');
      if (hardLimitReached) {
        await client.query(
          `UPDATE ${this.schemaSql}.workspace_state
           SET cognition_suspended=true,updated_at=clock_timestamp() WHERE namespace=$1`,
          [namespace],
        );
      } else {
        if (state.cognition_suspended) throw new Error('hard-limit compaction failure requires successful publication');
        await client.query(
          `UPDATE ${this.schemaSql}.windows
           SET status='active',frozen_through_journal_seq=NULL,frozen_through_event_cursor=NULL
           WHERE namespace=$1 AND window_id=$2`,
          [namespace, expectedWindowId],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async isCognitionSuspended(binding: WorkspaceBinding): Promise<boolean> {
    const result = await this.pool.query<{ cognition_suspended: boolean }>(
      `SELECT cognition_suspended FROM ${this.schemaSql}.workspace_state WHERE namespace=$1`,
      [createWorkspaceNamespace(binding)],
    );
    if (!result.rows[0]) throw new Error('workspace is not initialized');
    return result.rows[0].cognition_suspended;
  }

  async getRuntimeMetadata(binding: WorkspaceBinding): Promise<CognitionRuntimeMetadata> {
    return getWorkspaceRuntimeMetadata(this.pool, this.schemaSql, binding);
  }

  async setRuntimeMetadata(
    binding: WorkspaceBinding,
    input: Readonly<{
      expectedRevision: number;
      snapshot: Readonly<Record<string, unknown>>;
      logicalRounds: number;
      compactions: number;
    }>,
  ): Promise<CognitionRuntimeMetadata> {
    return setWorkspaceRuntimeMetadata(this.pool, this.schemaSql, binding, input);
  }

  async exportPortable(binding: WorkspaceBinding): Promise<PortableWorkspace> {
    return exportPortableWorkspace(this.pool, this.schemaSql, binding);
  }

  async importPortable(target: WorkspaceBinding, portable: PortableWorkspace): Promise<void> {
    await importPortableWorkspace(this.pool, this.schemaSql, target, portable);
  }

  async importPortableBatch(scope: WorkspaceTimelineScope, entries: readonly PortableWorkspaceImport[]): Promise<void> {
    await importPortableWorkspaceBatch(this.pool, this.schemaSql, scope, entries);
  }

  private async assertInitialized(binding: WorkspaceBinding): Promise<void> {
    const result = await this.pool.query(`SELECT 1 FROM ${this.schemaSql}.workspace_state WHERE namespace=$1`, [
      createWorkspaceNamespace(binding),
    ]);
    if (!result.rowCount) throw new Error('workspace is not initialized');
  }
}
