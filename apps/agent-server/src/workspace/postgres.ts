import {
  mapChatMessagesToStoredMessages,
  mapStoredMessagesToChatMessages,
  type BaseMessage,
  type StoredMessage,
} from '@langchain/core/messages';
import { Pool, type PoolClient } from 'pg';
import { createWorkspaceNamespace, normalizeWorkspaceBinding } from './namespace.js';
import { initializeWorkspace } from './initialization.js';
import { setupWorkspaceSchema } from './schema.js';
import { exportPortableWorkspace, importPortableWorkspace } from './portable.js';
import { freezeWorkspace, publishWorkspaceCompaction } from './compaction.js';
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
  type ReceivedEventPage,
  type RequestManifestInput,
  type Watermarks,
  type WorkspaceBinding,
  type WorkspaceDocument,
  type WorkspaceEvent,
  type WorkspaceFilePath,
  type WorkspaceReaderRole,
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

type JournalRow = {
  seq: string | number;
  message_id: string;
  window_id: string;
  message: StoredMessage;
  content_hash: string;
  world_event_range: [number, number] | null;
  created_at: Date | string;
};

function assertSchema(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/u.test(schema)) throw new Error('invalid PostgreSQL schema name');
  return `"${schema}"`;
}

function jsonValue(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value)) as unknown;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

async function hashJson(value: unknown): Promise<string> {
  const bytes = new TextEncoder().encode(canonicalJson(jsonValue(value)));
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function integer(value: string | number): number {
  return typeof value === 'number' ? value : Number.parseInt(value, 10);
}

function assertPath(path: string): asserts path is WorkspaceFilePath {
  if (!VISIBLE_PATHS.includes(path as WorkspaceFilePath)) throw new Error('workspace path is not visible');
}

function journalMessage(row: JournalRow): JournalMessage {
  return {
    seq: integer(row.seq),
    messageId: row.message_id,
    windowId: row.window_id,
    storedMessage: row.message,
    contentHash: row.content_hash,
    worldEventRange: row.world_event_range,
    createdAt: iso(row.created_at),
  };
}

function messageId(message: BaseMessage, fallback: string): string {
  return message.id && message.id.length > 0 ? message.id : fallback;
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
    const namespace = createWorkspaceNamespace(binding);
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const state = await this.lockedState(client, binding);
      let next = integer(state.next_journal_seq);
      const appended: JournalMessage[] = [];
      for (const entry of entries) {
        if (!entry.idempotencyKey) throw new Error('journal idempotency key is required');
        const id = messageId(entry.message, `${state.current_window_id}:${next}`);
        const serialized = mapChatMessagesToStoredMessages([entry.message])[0];
        if (!serialized) throw new Error('message serialization failed');
        const stored: StoredMessage = entry.message.id
          ? serialized
          : { ...serialized, data: { ...serialized.data, id } };
        const storedHash = await hashJson(stored);
        const result = await client.query<JournalRow>(
          `INSERT INTO ${this.schemaSql}.journal
            (namespace,seq,idempotency_key,message_id,window_id,message,content_hash,world_event_range)
           VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb)
           ON CONFLICT (namespace,idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
           RETURNING seq,message_id,window_id,message,content_hash,world_event_range,created_at`,
          [
            namespace,
            next,
            entry.idempotencyKey,
            id,
            state.current_window_id,
            JSON.stringify(stored),
            storedHash,
            entry.worldEventRange ? JSON.stringify(entry.worldEventRange) : null,
          ],
        );
        const row = result.rows[0];
        if (!row) throw new Error('journal insert failed');
        if (row.content_hash !== storedHash) throw new Error('journal idempotency key payload conflict');
        appended.push(journalMessage(row));
        if (integer(row.seq) === next) next += 1;
      }
      await client.query(
        `UPDATE ${this.schemaSql}.workspace_state SET next_journal_seq=$2,updated_at=clock_timestamp() WHERE namespace=$1`,
        [namespace, next],
      );
      await client.query('COMMIT');
      return appended;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getJournal(
    binding: WorkspaceBinding,
    options: Readonly<{ from?: number; through?: number }> = {},
  ): Promise<readonly JournalMessage[]> {
    const namespace = createWorkspaceNamespace(binding);
    const result = await this.pool.query<JournalRow>(
      `SELECT seq,message_id,window_id,message,content_hash,world_event_range,created_at
       FROM ${this.schemaSql}.journal WHERE namespace=$1 AND seq >= $2 AND seq <= $3 ORDER BY seq`,
      [namespace, options.from ?? 1, options.through ?? Number.MAX_SAFE_INTEGER],
    );
    return result.rows.map(journalMessage);
  }

  restoreMessages(messages: readonly JournalMessage[]): BaseMessage[] {
    return mapStoredMessagesToChatMessages(messages.map((entry) => entry.storedMessage));
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
        await client.query(
          `INSERT INTO ${this.schemaSql}.immutable_blobs(content_hash,payload) VALUES ($1,$2::jsonb)
           ON CONFLICT (content_hash) DO NOTHING`,
          [ref, JSON.stringify(payload)],
        );
      }
      await client.query(
        `INSERT INTO ${this.schemaSql}.request_manifests
          (namespace,request_id,logical_model,through_journal_seq,request_payload_ref,prefix_ref,tool_schema_ref,tool_schema_revision,model_configuration_revision,gateway_audit_ref)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (namespace,request_id) DO NOTHING`,
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
    const namespace = createWorkspaceNamespace(binding);
    await this.pool.query(
      `INSERT INTO ${this.schemaSql}.request_receipts(namespace,request_id,outcome)
       VALUES ($1,$2,$3::jsonb) ON CONFLICT (namespace,request_id) DO NOTHING`,
      [namespace, requestId, JSON.stringify(outcome)],
    );
  }

  async freezeForCompaction(binding: WorkspaceBinding): Promise<FrozenCompaction> {
    return freezeWorkspace(
      this.pool,
      this.schemaSql,
      binding,
      () => this.readFile(binding, '/MEMORY.md', 'memory-editor'),
      (through) => this.getJournal(binding, { through }),
    );
  }

  async publishCompaction(
    binding: WorkspaceBinding,
    draft: MemoryDraft,
  ): Promise<Readonly<{ commitId: string; memoryRevision: number; windowId: string }>> {
    return publishWorkspaceCompaction(this.pool, this.schemaSql, binding, draft);
  }

  async markCompactionFailure(binding: WorkspaceBinding, hardLimitReached: boolean): Promise<void> {
    if (!hardLimitReached) return;
    await this.pool.query(
      `UPDATE ${this.schemaSql}.workspace_state SET cognition_suspended=true,updated_at=clock_timestamp() WHERE namespace=$1`,
      [createWorkspaceNamespace(binding)],
    );
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

  private async assertInitialized(binding: WorkspaceBinding): Promise<void> {
    const result = await this.pool.query(`SELECT 1 FROM ${this.schemaSql}.workspace_state WHERE namespace=$1`, [
      createWorkspaceNamespace(binding),
    ]);
    if (!result.rowCount) throw new Error('workspace is not initialized');
  }
}
