import {
  mapChatMessagesToStoredMessages,
  mapStoredMessagesToChatMessages,
  type BaseMessage,
  type StoredMessage,
} from '@langchain/core/messages';
import type { Pool, PoolClient } from 'pg';
import { boundedInteger, hashJson, integer, iso } from './codec.js';
import { createWorkspaceNamespace } from './namespace.js';
import {
  JOURNAL_MESSAGE_UTF8_LIMIT,
  JOURNAL_READ_ROW_LIMIT,
  JOURNAL_READ_UTF8_LIMIT,
  JOURNAL_WINDOW_MESSAGE_LIMIT,
  JOURNAL_WINDOW_UTF8_LIMIT,
  type JournalMessage,
  type JournalMessageInput,
  type WorkspaceBinding,
} from './types.js';

type StateRow = { current_window_id: string; next_journal_seq: string | number };
type JournalRow = {
  seq: string | number;
  message_id: string;
  window_id: string;
  message: StoredMessage;
  content_hash: string;
  world_event_range: [number, number] | null;
  created_at: Date | string;
  message_bytes?: string | number;
};
type JournalSizeRow = { row_count: string | number; utf8_bytes: string | number };

async function lockedState(client: PoolClient, schema: string, namespace: string): Promise<StateRow> {
  const result = await client.query<StateRow>(
    `SELECT current_window_id,next_journal_seq FROM ${schema}.workspace_state WHERE namespace=$1 FOR UPDATE`,
    [namespace],
  );
  if (!result.rows[0]) throw new Error('workspace is not initialized');
  return result.rows[0];
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

export async function appendWorkspaceMessages(
  pool: Pool,
  schema: string,
  binding: WorkspaceBinding,
  entries: readonly JournalMessageInput[],
): Promise<readonly JournalMessage[]> {
  const namespace = createWorkspaceNamespace(binding);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const state = await lockedState(client, schema, namespace);
    const window = await client.query<{ status: string }>(
      `SELECT status FROM ${schema}.windows WHERE namespace=$1 AND window_id=$2 FOR UPDATE`,
      [namespace, state.current_window_id],
    );
    if (window.rows[0]?.status !== 'active')
      throw new Error('workspace journal window is frozen; compaction must publish or explicitly recover first');
    const size = (
      await client.query<JournalSizeRow>(
        `SELECT count(*)::bigint AS row_count,coalesce(sum(octet_length(message::text)),0)::bigint AS utf8_bytes
         FROM ${schema}.journal WHERE namespace=$1 AND window_id=$2`,
        [namespace, state.current_window_id],
      )
    ).rows[0];
    let windowRows = integer(size?.row_count ?? 0);
    let windowBytes = integer(size?.utf8_bytes ?? 0);
    let next = integer(state.next_journal_seq);
    const appended: JournalMessage[] = [];
    for (const entry of entries) {
      if (!entry.idempotencyKey || entry.idempotencyKey.length > 256)
        throw new Error('journal idempotency key is required and must be bounded');
      if (
        entry.worldEventRange &&
        (!Number.isSafeInteger(entry.worldEventRange[0]) ||
          !Number.isSafeInteger(entry.worldEventRange[1]) ||
          entry.worldEventRange[0] < 0 ||
          entry.worldEventRange[1] < entry.worldEventRange[0])
      )
        throw new Error('journal world event range is invalid');
      const id = entry.message.id?.length ? entry.message.id : `${state.current_window_id}:${next}`;
      const serialized = mapChatMessagesToStoredMessages([entry.message])[0];
      if (!serialized) throw new Error('message serialization failed');
      const stored: StoredMessage = { ...serialized, data: { ...serialized.data, id } };
      const storedJson = JSON.stringify(stored);
      const storedBytes = Buffer.byteLength(storedJson, 'utf8');
      if (storedBytes > JOURNAL_MESSAGE_UTF8_LIMIT) throw new Error('journal message UTF-8 size exceeds limit');
      const storedHash = await hashJson(stored);
      const result = await client.query<JournalRow>(
        `INSERT INTO ${schema}.journal
          (namespace,seq,idempotency_key,message_id,window_id,message,content_hash,world_event_range)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8::jsonb)
         ON CONFLICT (namespace,idempotency_key) DO UPDATE SET idempotency_key=EXCLUDED.idempotency_key
         RETURNING seq,message_id,window_id,message,content_hash,world_event_range,created_at,
           octet_length(message::text)::bigint AS message_bytes`,
        [
          namespace,
          next,
          entry.idempotencyKey,
          id,
          state.current_window_id,
          storedJson,
          storedHash,
          entry.worldEventRange ? JSON.stringify(entry.worldEventRange) : null,
        ],
      );
      const row = result.rows[0];
      if (!row) throw new Error('journal insert failed');
      if (row.content_hash !== storedHash) throw new Error('journal idempotency key payload conflict');
      appended.push(journalMessage(row));
      if (integer(row.seq) === next) {
        const persistedBytes = integer(row.message_bytes ?? storedBytes);
        if (persistedBytes > JOURNAL_MESSAGE_UTF8_LIMIT) throw new Error('journal message UTF-8 size exceeds limit');
        windowRows += 1;
        windowBytes += persistedBytes;
        if (windowRows > JOURNAL_WINDOW_MESSAGE_LIMIT) throw new Error('journal window row limit exceeded');
        if (windowBytes > JOURNAL_WINDOW_UTF8_LIMIT) throw new Error('journal window UTF-8 size limit exceeded');
        next += 1;
      }
    }
    await client.query(
      `UPDATE ${schema}.workspace_state SET next_journal_seq=$2,updated_at=clock_timestamp() WHERE namespace=$1`,
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

export async function getWorkspaceJournal(
  pool: Pool,
  schema: string,
  binding: WorkspaceBinding,
  options: Readonly<{
    from?: number;
    through?: number;
    windowId?: string;
    limit?: number;
    maxUtf8Bytes?: number;
  }> = {},
): Promise<readonly JournalMessage[]> {
  const namespace = createWorkspaceNamespace(binding);
  const from = boundedInteger(options.from ?? 1, 'journal read lower boundary', 0, Number.MAX_SAFE_INTEGER);
  const through = boundedInteger(
    options.through ?? Number.MAX_SAFE_INTEGER,
    'journal read upper boundary',
    from,
    Number.MAX_SAFE_INTEGER,
  );
  const limit = boundedInteger(
    options.limit ?? JOURNAL_READ_ROW_LIMIT,
    'journal read row limit',
    1,
    JOURNAL_READ_ROW_LIMIT,
  );
  const maxUtf8Bytes = boundedInteger(
    options.maxUtf8Bytes ?? JOURNAL_READ_UTF8_LIMIT,
    'journal read byte limit',
    1,
    JOURNAL_READ_UTF8_LIMIT,
  );
  if (options.windowId !== undefined && (!options.windowId || options.windowId.length > 128))
    throw new Error('journal read window id is invalid');
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const parameters = [namespace, from, through, options.windowId ?? null];
    const size = (
      await client.query<JournalSizeRow>(
        `SELECT count(*)::bigint AS row_count,coalesce(sum(octet_length(message::text)),0)::bigint AS utf8_bytes
         FROM ${schema}.journal
         WHERE namespace=$1 AND seq >= $2 AND seq <= $3 AND ($4::text IS NULL OR window_id=$4)`,
        parameters,
      )
    ).rows[0];
    if (integer(size?.row_count ?? 0) > limit) throw new Error('journal read exceeds row limit; paginate by sequence');
    if (integer(size?.utf8_bytes ?? 0) > maxUtf8Bytes)
      throw new Error('journal read exceeds byte limit; paginate by sequence');
    const result = await client.query<JournalRow>(
      `SELECT seq,message_id,window_id,message,content_hash,world_event_range,created_at
       FROM ${schema}.journal
       WHERE namespace=$1 AND seq >= $2 AND seq <= $3 AND ($4::text IS NULL OR window_id=$4)
       ORDER BY seq`,
      parameters,
    );
    await client.query('COMMIT');
    return result.rows.map(journalMessage);
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export function restoreWorkspaceMessages(messages: readonly JournalMessage[]): BaseMessage[] {
  return mapStoredMessagesToChatMessages(messages.map((entry) => entry.storedMessage));
}
