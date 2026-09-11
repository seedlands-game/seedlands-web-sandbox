import type { Pool } from 'pg';
import { createWorkspaceNamespace, normalizeWorkspaceBinding } from './namespace.js';
import { serializeRuntimeSnapshot, validateWorkspaceDocument } from './content-codec.js';
import {
  JOURNAL_MESSAGE_UTF8_LIMIT,
  JOURNAL_WINDOW_MESSAGE_LIMIT,
  JOURNAL_WINDOW_UTF8_LIMIT,
  type PortableWorkspace,
  type WorkspaceBinding,
} from './types.js';

function jsonValue(value: unknown): Record<string, unknown> {
  return JSON.parse(JSON.stringify(value)) as Record<string, unknown>;
}

function canonicalPortableJson(entry: unknown): string {
  if (Array.isArray(entry)) return `[${entry.map(canonicalPortableJson).join(',')}]`;
  if (entry && typeof entry === 'object') {
    const object = entry as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalPortableJson(object[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(entry);
}

async function hashPortableValue(value: unknown): Promise<string> {
  const normalized = JSON.parse(JSON.stringify(value)) as unknown;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalPortableJson(normalized)));
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

const object = (value: unknown): value is Record<string, unknown> =>
  Boolean(value && typeof value === 'object' && !Array.isArray(value));

function portableError(reason: string): never {
  throw new Error(`portable workspace ${reason}`);
}

function textField(row: Readonly<Record<string, unknown>>, field: string): string {
  const value = row[field];
  if (typeof value !== 'string' || !value) portableError(`${field} is invalid`);
  return value;
}

function integerField(row: Readonly<Record<string, unknown>>, field: string, minimum = 0): number {
  const raw = row[field];
  const value =
    typeof raw === 'number' ? raw : typeof raw === 'string' && /^\d+$/u.test(raw) ? Number(raw) : Number.NaN;
  if (!Number.isSafeInteger(value) || value < minimum) portableError(`${field} is invalid`);
  return value;
}

function nullableIntegerField(row: Readonly<Record<string, unknown>>, field: string): number | null {
  return row[field] === null || row[field] === undefined ? null : integerField(row, field);
}

function uniqueRow(seen: Set<string>, key: string, label: string): void {
  if (seen.has(key)) portableError(`${label} is duplicated`);
  seen.add(key);
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalPortableJson(left) === canonicalPortableJson(right);
}

export async function validatePortableWorkspace(portable: PortableWorkspace): Promise<void> {
  if (portable.format !== 'seedlands-npc-workspace' || portable.schemaVersion !== 1)
    throw new Error('unsupported portable workspace');
  if (
    !object(portable.state) ||
    !object(portable.runtimeMetadata) ||
    !Array.isArray(portable.documents) ||
    !Array.isArray(portable.journal) ||
    !Array.isArray(portable.events) ||
    !Array.isArray(portable.eventPages) ||
    !Array.isArray(portable.windows) ||
    !Array.isArray(portable.manifests) ||
    !Array.isArray(portable.receipts) ||
    !Array.isArray(portable.compactionCommits) ||
    !Array.isArray(portable.blobs)
  )
    portableError('tables are invalid');
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
  if (!sameJson(portable.state.binding, normalizeWorkspaceBinding(portable.binding)))
    portableError('state binding does not match its trusted binding');

  const documentKeys = new Set<string>();
  const memoryRevisions = new Set<number>();
  for (const document of portable.documents) {
    const path = textField(document, 'path');
    const revision = integerField(document, 'revision', 1);
    uniqueRow(documentKeys, `${path}:${revision}`, 'document identity');
    if (!['/AGENT.md', '/SOUL.md', '/MEMORY.md', '/behavior/current.json'].includes(path))
      portableError('document path is invalid');
    if (typeof document.content !== 'string') portableError('document content is invalid');
    validateWorkspaceDocument(path, document.content);
    if ((await hashPortableValue(document.content)) !== document.content_hash)
      throw new Error('portable workspace document checksum mismatch');
    if (new TextEncoder().encode(document.content).byteLength !== integerField(document, 'utf8_bytes'))
      portableError('document UTF-8 size is inconsistent');
    if (path === '/MEMORY.md') memoryRevisions.add(revision);
  }
  for (const required of ['/AGENT.md', '/SOUL.md', '/MEMORY.md', '/behavior/current.json'])
    if (![...documentKeys].some((key) => key.startsWith(`${required}:`)))
      portableError(`required ${required} is missing`);

  const windows = new Map<string, Readonly<Record<string, unknown>>>();
  for (const window of portable.windows) {
    const id = textField(window, 'window_id');
    if (windows.has(id)) portableError('window identity is duplicated');
    const status = textField(window, 'status');
    if (!['active', 'frozen', 'sealed'].includes(status)) portableError('window status is invalid');
    const memoryRevision = integerField(window, 'memory_revision', 1);
    if (!memoryRevisions.has(memoryRevision)) portableError('window references missing memory');
    const startsAfter = integerField(window, 'starts_after_journal_seq');
    const frozenThrough = nullableIntegerField(window, 'frozen_through_journal_seq');
    const frozenEvents = nullableIntegerField(window, 'frozen_through_event_cursor');
    if (status === 'active' && (frozenThrough !== null || frozenEvents !== null))
      portableError('active window has a frozen boundary');
    if (status !== 'active' && (frozenThrough === null || frozenEvents === null || frozenThrough < startsAfter))
      portableError('frozen window boundary is invalid');
    windows.set(id, window);
  }

  const currentWindowId = textField(portable.state, 'current_window_id');
  const currentWindow = windows.get(currentWindowId);
  if (!currentWindow || currentWindow.status === 'sealed') portableError('current window is missing or sealed');
  const memoryRevision = integerField(portable.state, 'memory_revision', 1);
  if (!memoryRevisions.has(memoryRevision) || integerField(currentWindow, 'memory_revision', 1) !== memoryRevision)
    portableError('current memory revision is missing or inconsistent');
  const openWindows = [...windows.values()].filter((window) => window.status !== 'sealed');
  if (openWindows.length !== 1 || openWindows[0]?.window_id !== currentWindowId)
    portableError('window lifecycle has multiple current candidates');

  const journalSequences = new Set<string>();
  const journalKeys = new Set<string>();
  const journalByWindow = new Map<string, { rows: number; bytes: number; sequences: Set<number> }>();
  let greatestJournalSeq = 0;
  for (const journal of portable.journal) {
    const seq = integerField(journal, 'seq', 1);
    const idempotencyKey = textField(journal, 'idempotency_key');
    uniqueRow(journalSequences, String(seq), 'journal sequence');
    uniqueRow(journalKeys, idempotencyKey, 'journal idempotency key');
    textField(journal, 'message_id');
    const windowId = textField(journal, 'window_id');
    const window = windows.get(windowId);
    if (!window) portableError('journal references a missing window');
    if (!object(journal.message)) portableError('journal message is invalid');
    if ((await hashPortableValue(journal.message)) !== journal.content_hash)
      throw new Error('portable workspace journal checksum mismatch');
    const bytes = new TextEncoder().encode(JSON.stringify(journal.message)).byteLength;
    if (bytes > JOURNAL_MESSAGE_UTF8_LIMIT) portableError('journal message exceeds the UTF-8 limit');
    const startsAfter = integerField(window, 'starts_after_journal_seq');
    const frozenThrough = nullableIntegerField(window, 'frozen_through_journal_seq');
    if (seq <= startsAfter || (frozenThrough !== null && seq > frozenThrough))
      portableError('journal sequence is outside its window boundary');
    const aggregate = journalByWindow.get(windowId) ?? { rows: 0, bytes: 0, sequences: new Set<number>() };
    aggregate.rows += 1;
    aggregate.bytes += bytes;
    aggregate.sequences.add(seq);
    if (aggregate.rows > JOURNAL_WINDOW_MESSAGE_LIMIT || aggregate.bytes > JOURNAL_WINDOW_UTF8_LIMIT)
      portableError('journal window exceeds its storage limit');
    journalByWindow.set(windowId, aggregate);
    greatestJournalSeq = Math.max(greatestJournalSeq, seq);
    const eventRange = journal.world_event_range;
    if (
      eventRange !== null &&
      (!Array.isArray(eventRange) ||
        eventRange.length !== 2 ||
        !eventRange.every(Number.isSafeInteger) ||
        Number(eventRange[0]) < 0 ||
        Number(eventRange[1]) < Number(eventRange[0]))
    )
      portableError('journal world event range is invalid');
  }
  if (integerField(portable.state, 'next_journal_seq', 1) !== greatestJournalSeq + 1)
    portableError('next journal sequence is inconsistent');
  // Journal rows are never pruned by compaction; unlike world events, this schema has no lost-range record.
  if (journalSequences.size !== greatestJournalSeq) portableError('journal sequence has a missing message');
  const orderedWindows = [...windows.values()].sort(
    (left, right) => integerField(left, 'memory_revision', 1) - integerField(right, 'memory_revision', 1),
  );
  let previousThrough = 0;
  for (const [index, window] of orderedWindows.entries()) {
    const id = textField(window, 'window_id');
    const startsAfter = integerField(window, 'starts_after_journal_seq');
    const through =
      window.status === 'active' ? greatestJournalSeq : integerField(window, 'frozen_through_journal_seq');
    if (integerField(window, 'memory_revision', 1) !== index + 1 || startsAfter !== previousThrough)
      portableError('window history is not a continuous chain');
    if (
      through > greatestJournalSeq ||
      through < startsAfter ||
      (journalByWindow.get(id)?.rows ?? 0) !== through - startsAfter
    )
      portableError('window journal coverage is incomplete');
    if (index === orderedWindows.length - 1 ? id !== currentWindowId : window.status !== 'sealed')
      portableError('current window is not the end of its history');
    previousThrough = through;
  }
  if (previousThrough !== greatestJournalSeq || memoryRevisions.size !== orderedWindows.length)
    portableError('window history and memory revisions are inconsistent');

  const received = integerField(portable.state, 'received_through');
  const included = integerField(portable.state, 'included_through');
  const compacted = integerField(portable.state, 'compacted_through');
  if (compacted > included || included > received) portableError('event watermarks are not monotonic');
  if (typeof portable.state.cognition_suspended !== 'boolean') portableError('cognition suspension state is invalid');
  const eventIds = new Set<string>();
  const eventCursors = new Set<string>();
  for (const event of portable.events) {
    uniqueRow(eventIds, textField(event, 'event_id'), 'event identity');
    const cursor = integerField(event, 'cursor', 1);
    uniqueRow(eventCursors, String(cursor), 'event cursor');
    if (cursor > received || !object(event.payload)) portableError('event is outside the received watermark');
  }
  const pageIds = new Set<string>();
  for (const page of portable.eventPages) {
    uniqueRow(pageIds, textField(page, 'page_id'), 'event page identity');
    if (!object(page.coverage)) portableError('event page coverage is invalid');
    const requestedAfter = integerField(page.coverage, 'requestedAfter');
    const through = integerField(page.coverage, 'through');
    const returnedThrough = integerField(page.coverage, 'returnedThrough');
    if (requestedAfter > through || returnedThrough < requestedAfter || returnedThrough > through || through > received)
      portableError('event page coverage boundary is invalid');
    if (typeof page.coverage.hasMore !== 'boolean') portableError('event page hasMore is invalid');
    if (page.coverage.lostRange !== undefined) {
      if (!object(page.coverage.lostRange)) portableError('event page lost range is invalid');
      const from = integerField(page.coverage.lostRange, 'from', 1);
      const to = integerField(page.coverage.lostRange, 'to', 1);
      if (from > to || to > through) portableError('event page lost range boundary is invalid');
    }
  }

  integerField(portable.runtimeMetadata, 'revision', 1);
  integerField(portable.runtimeMetadata, 'logical_rounds');
  integerField(portable.runtimeMetadata, 'compactions');
  if (!object(portable.runtimeMetadata.snapshot)) portableError('runtime metadata snapshot is invalid');
  serializeRuntimeSnapshot(portable.runtimeMetadata.snapshot);

  const blobRefs = new Set<string>();
  for (const blob of portable.blobs) {
    const ref = textField(blob, 'content_hash');
    uniqueRow(blobRefs, ref, 'immutable blob');
    if ((await hashPortableValue(blob.payload)) !== blob.content_hash)
      throw new Error('portable workspace immutable blob checksum mismatch');
  }
  const manifestIds = new Set<string>();
  for (const manifest of portable.manifests) {
    uniqueRow(manifestIds, textField(manifest, 'request_id'), 'request manifest identity');
    if (!['flash', 'pro'].includes(textField(manifest, 'logical_model')))
      portableError('request manifest model is invalid');
    if (integerField(manifest, 'through_journal_seq') > greatestJournalSeq)
      portableError('request manifest is beyond the journal');
    for (const field of ['request_payload_ref', 'prefix_ref', 'tool_schema_ref'] as const)
      if (!blobRefs.has(String(manifest[field]))) throw new Error('portable workspace manifest has a missing blob');
  }
  const receiptIds = new Set<string>();
  for (const receipt of portable.receipts) {
    uniqueRow(receiptIds, textField(receipt, 'request_id'), 'request receipt identity');
    if (!object(receipt.outcome)) portableError('request receipt outcome is invalid');
  }

  const commitIds = new Set<string>();
  const committedWindows = new Set<string>();
  for (const commit of portable.compactionCommits) {
    uniqueRow(commitIds, textField(commit, 'commit_id'), 'compaction commit identity');
    const frozenWindowId = textField(commit, 'frozen_window_id');
    uniqueRow(committedWindows, frozenWindowId, 'compaction frozen window');
    const nextWindowId = textField(commit, 'next_window_id');
    const frozenWindow = windows.get(frozenWindowId);
    const nextWindow = windows.get(nextWindowId);
    const through = integerField(commit, 'through_journal_seq');
    const throughEvents = integerField(commit, 'through_event_cursor');
    const oldMemory = integerField(commit, 'old_memory_revision', 1);
    const newMemory = integerField(commit, 'new_memory_revision', 1);
    if (
      !frozenWindow ||
      frozenWindow.status !== 'sealed' ||
      !nextWindow ||
      integerField(frozenWindow, 'memory_revision', 1) !== oldMemory ||
      nullableIntegerField(frozenWindow, 'frozen_through_journal_seq') !== through ||
      nullableIntegerField(frozenWindow, 'frozen_through_event_cursor') !== throughEvents ||
      integerField(nextWindow, 'memory_revision', 1) !== newMemory ||
      integerField(nextWindow, 'starts_after_journal_seq') !== through ||
      newMemory !== oldMemory + 1 ||
      !memoryRevisions.has(oldMemory) ||
      !memoryRevisions.has(newMemory) ||
      throughEvents > compacted ||
      !Array.isArray(commit.sources)
    )
      portableError('compaction commit relation is invalid');
    const frozenSequences = journalByWindow.get(frozenWindowId)?.sequences ?? new Set<number>();
    for (const source of commit.sources) {
      if (!object(source)) portableError('compaction source is invalid');
      const sourceSeq = integerField(source, 'journalSeq');
      const kind = textField(source, 'kind');
      if (
        !['observed', 'authority-receipt', 'resident-decision', 'prior-memory'].includes(kind) ||
        (kind === 'prior-memory' && sourceSeq !== 0) ||
        (kind !== 'prior-memory' && !frozenSequences.has(sourceSeq))
      )
        portableError('compaction source is outside its frozen window');
    }
  }
  for (const [windowId, window] of windows)
    if (window.status === 'sealed' && !committedWindows.has(windowId))
      portableError('sealed window has no compaction commit');
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
