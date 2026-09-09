import type { StoredMessage } from '@langchain/core/messages';
import type { Pool, PoolClient } from 'pg';
import { createWorkspaceNamespace } from './namespace.js';
import {
  MEMORY_TOKEN_LIMIT,
  MEMORY_UTF8_LIMIT,
  type FrozenCompaction,
  type JournalMessage,
  type MemoryDraft,
  type WorkspaceBinding,
  type WorkspaceDocument,
} from './types.js';

type State = {
  current_window_id: string;
  memory_revision: number;
  next_journal_seq: string | number;
  included_through: string | number;
};
const integer = (value: string | number): number => (typeof value === 'number' ? value : Number.parseInt(value, 10));

async function hashContent(content: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(content)));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

async function lockState(client: PoolClient, schema: string, namespace: string): Promise<State> {
  const result = await client.query<State>(`SELECT * FROM ${schema}.workspace_state WHERE namespace=$1 FOR UPDATE`, [
    namespace,
  ]);
  if (!result.rows[0]) throw new Error('workspace is not initialized');
  return result.rows[0];
}

async function assertCompleteToolRounds(client: PoolClient, schema: string, namespace: string, through: number) {
  const rows = (
    await client.query<{ message: StoredMessage }>(
      `SELECT message FROM ${schema}.journal WHERE namespace=$1 AND seq <= $2 ORDER BY seq`,
      [namespace, through],
    )
  ).rows;
  const open = new Set<string>();
  for (const { message } of rows) {
    const data = message.data as unknown as Record<string, unknown>;
    if (Array.isArray(data.tool_calls))
      for (const call of data.tool_calls)
        if (call && typeof call === 'object' && 'id' in call) open.add(String(call.id));
    if (message.type === 'tool' && typeof data.tool_call_id === 'string') open.delete(data.tool_call_id);
  }
  if (open.size > 0) throw new Error('cannot freeze an incomplete tool round');
}

export async function freezeWorkspace(
  pool: Pool,
  schema: string,
  binding: WorkspaceBinding,
  readMemory: () => Promise<WorkspaceDocument>,
  readJournal: (through: number) => Promise<readonly JournalMessage[]>,
): Promise<FrozenCompaction> {
  const namespace = createWorkspaceNamespace(binding);
  const client = await pool.connect();
  let state!: State;
  let through: number;
  let throughEventCursor: number;
  try {
    await client.query('BEGIN');
    state = await lockState(client, schema, namespace);
    through = integer(state.next_journal_seq) - 1;
    throughEventCursor = integer(state.included_through);
    const result = await client.query<{
      status: string;
      frozen_through_journal_seq: string | number | null;
      frozen_through_event_cursor: string | number | null;
    }>(
      `SELECT status,frozen_through_journal_seq,frozen_through_event_cursor FROM ${schema}.windows WHERE namespace=$1 AND window_id=$2 FOR UPDATE`,
      [namespace, state.current_window_id],
    );
    const window = result.rows[0];
    if (!window) throw new Error('current window does not exist');
    if (window.status === 'active') {
      await assertCompleteToolRounds(client, schema, namespace, through);
      await client.query(
        `UPDATE ${schema}.windows SET status='frozen',frozen_through_journal_seq=$3,frozen_through_event_cursor=$4 WHERE namespace=$1 AND window_id=$2`,
        [namespace, state.current_window_id, through, throughEventCursor],
      );
    } else if (window.status === 'frozen') {
      through = integer(window.frozen_through_journal_seq ?? 0);
      throughEventCursor = integer(window.frozen_through_event_cursor ?? 0);
    } else throw new Error('current window is already sealed');
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
  const [memory, messages] = await Promise.all([readMemory(), readJournal(through)]);
  return {
    windowId: state.current_window_id,
    memoryRevision: state.memory_revision,
    throughJournalSeq: through,
    throughEventCursor,
    messages: messages.filter((message) => message.windowId === state.current_window_id),
    memory,
  };
}

export async function publishWorkspaceCompaction(
  pool: Pool,
  schema: string,
  binding: WorkspaceBinding,
  draft: MemoryDraft,
): Promise<Readonly<{ commitId: string; memoryRevision: number; windowId: string }>> {
  const bytes = new TextEncoder().encode(draft.content).byteLength;
  if (!draft.content.trim()) throw new Error('memory draft is empty');
  if (
    !Number.isInteger(draft.estimatedTokens) ||
    draft.estimatedTokens < 0 ||
    draft.estimatedTokens > MEMORY_TOKEN_LIMIT
  )
    throw new Error('memory token estimate exceeds limit');
  if (bytes > MEMORY_UTF8_LIMIT) throw new Error('memory UTF-8 size exceeds limit');
  if (draft.sources.length === 0) throw new Error('memory draft must cite frozen-window sources');
  const namespace = createWorkspaceNamespace(binding);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const state = await lockState(client, schema, namespace);
    if (state.current_window_id !== draft.frozenWindowId || state.memory_revision !== draft.expectedMemoryRevision)
      throw new Error('memory revision or frozen window conflict');
    const window = (
      await client.query<{
        status: string;
        frozen_through_journal_seq: string | number;
        frozen_through_event_cursor: string | number;
      }>(
        `SELECT status,frozen_through_journal_seq,frozen_through_event_cursor FROM ${schema}.windows WHERE namespace=$1 AND window_id=$2 FOR UPDATE`,
        [namespace, draft.frozenWindowId],
      )
    ).rows[0];
    if (!window || window.status !== 'frozen' || integer(window.frozen_through_journal_seq) !== draft.throughJournalSeq)
      throw new Error('compaction frozen boundary conflict');
    const validSources = new Set(
      (
        await client.query<{ seq: string | number }>(
          `SELECT seq FROM ${schema}.journal WHERE namespace=$1 AND window_id=$2 AND seq <= $3`,
          [namespace, draft.frozenWindowId, draft.throughJournalSeq],
        )
      ).rows.map((row) => integer(row.seq)),
    );
    if (
      draft.sources.some(
        (source) =>
          (source.kind === 'prior-memory' && source.journalSeq !== 0) ||
          (source.kind !== 'prior-memory' && !validSources.has(source.journalSeq)),
      )
    )
      throw new Error('memory draft cites data outside the frozen window');
    const newRevision = state.memory_revision + 1;
    const nextWindowId = `window-${newRevision}`;
    const commitId = crypto.randomUUID();
    const inserted = await client.query(
      `INSERT INTO ${schema}.documents(namespace,path,revision,content,utf8_bytes,content_hash,schema_version,template_version,writer_role)
       SELECT $1,'/MEMORY.md',$2,$3,$4,$5,schema_version,template_version,'pro-memory-editor'
       FROM ${schema}.documents WHERE namespace=$1 AND path='/MEMORY.md' AND revision=$6`,
      [namespace, newRevision, draft.content, bytes, await hashContent(draft.content), state.memory_revision],
    );
    if (inserted.rowCount !== 1) throw new Error('current memory revision is missing');
    await client.query(
      `INSERT INTO ${schema}.compaction_commits(namespace,commit_id,frozen_window_id,through_journal_seq,through_event_cursor,old_memory_revision,new_memory_revision,next_window_id,sources)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb)`,
      [
        namespace,
        commitId,
        draft.frozenWindowId,
        draft.throughJournalSeq,
        integer(window.frozen_through_event_cursor),
        state.memory_revision,
        newRevision,
        nextWindowId,
        JSON.stringify(draft.sources),
      ],
    );
    await client.query(
      `UPDATE ${schema}.windows SET status='sealed',sealed_at=clock_timestamp() WHERE namespace=$1 AND window_id=$2`,
      [namespace, draft.frozenWindowId],
    );
    await client.query(
      `INSERT INTO ${schema}.windows(namespace,window_id,status,memory_revision,starts_after_journal_seq) VALUES ($1,$2,'active',$3,$4)`,
      [namespace, nextWindowId, newRevision, draft.throughJournalSeq],
    );
    await client.query(
      `UPDATE ${schema}.workspace_state SET current_window_id=$2,memory_revision=$3,compacted_through=$4,cognition_suspended=false,updated_at=clock_timestamp() WHERE namespace=$1`,
      [namespace, nextWindowId, newRevision, integer(window.frozen_through_event_cursor)],
    );
    await client.query('COMMIT');
    return { commitId, memoryRevision: newRevision, windowId: nextWindowId };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}
