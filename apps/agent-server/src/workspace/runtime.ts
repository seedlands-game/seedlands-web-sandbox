import type { Pool } from 'pg';
import { createWorkspaceNamespace } from './namespace.js';
import { serializeRuntimeSnapshot } from './content-codec.js';
import type {
  CognitionRuntimeMetadata,
  EventPageCoverage,
  ReceivedEventPage,
  Watermarks,
  WorkspaceBinding,
} from './types.js';

function integer(value: string | number): number {
  return typeof value === 'number' ? value : Number.parseInt(value, 10);
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

function assertCursor(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} must be a non-negative safe integer`);
}

function assertCoverage(coverage: EventPageCoverage): void {
  assertCursor(coverage.requestedAfter, 'requestedAfter');
  assertCursor(coverage.through, 'through');
  assertCursor(coverage.returnedThrough, 'returnedThrough');
  if (coverage.through < coverage.requestedAfter) throw new Error('event page through precedes requestedAfter');
  if (coverage.returnedThrough < coverage.requestedAfter || coverage.returnedThrough > coverage.through)
    throw new Error('event page returnedThrough is outside requested coverage');
  if (typeof coverage.hasMore !== 'boolean') throw new Error('event page hasMore must be boolean');
  if (coverage.lostRange) {
    assertCursor(coverage.lostRange.from, 'lostRange.from');
    assertCursor(coverage.lostRange.to, 'lostRange.to');
    if (
      coverage.lostRange.from <= coverage.requestedAfter ||
      coverage.lostRange.from > coverage.lostRange.to ||
      coverage.lostRange.to > coverage.through
    )
      throw new Error('invalid lost event range');
  }
}

export async function receiveWorkspaceEventPage(
  pool: Pool,
  schema: string,
  binding: WorkspaceBinding,
  page: ReceivedEventPage,
): Promise<Watermarks> {
  if (!page.pageId) throw new Error('event page id is required');
  assertCoverage(page.coverage);
  for (const event of page.events) {
    if (!event.eventId || !Number.isSafeInteger(event.cursor) || event.cursor <= page.coverage.requestedAfter)
      throw new Error('event is outside requested page');
    if (event.cursor > page.coverage.returnedThrough) throw new Error('event is beyond returnedThrough');
  }
  const namespace = createWorkspaceNamespace(binding);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const stateResult = await client.query<{
      received_through: string | number;
      included_through: string | number;
      compacted_through: string | number;
    }>(`SELECT * FROM ${schema}.workspace_state WHERE namespace=$1 FOR UPDATE`, [namespace]);
    const state = stateResult.rows[0];
    if (!state) throw new Error('workspace is not initialized');
    const coverageJson = JSON.stringify(page.coverage);
    const pageResult = await client.query<{ coverage: EventPageCoverage }>(
      `INSERT INTO ${schema}.event_pages(namespace,page_id,coverage) VALUES ($1,$2,$3::jsonb)
       ON CONFLICT (namespace,page_id) DO UPDATE SET page_id=EXCLUDED.page_id RETURNING coverage`,
      [namespace, page.pageId, coverageJson],
    );
    if (canonicalJson(pageResult.rows[0]?.coverage) !== canonicalJson(page.coverage))
      throw new Error('event page idempotency key payload conflict');
    for (const event of page.events) {
      const inserted = await client.query<{ cursor: string | number; payload: Record<string, unknown> }>(
        `INSERT INTO ${schema}.world_events(namespace,event_id,cursor,payload)
         VALUES ($1,$2,$3,$4::jsonb) ON CONFLICT (namespace,event_id) DO UPDATE SET event_id=EXCLUDED.event_id
         RETURNING cursor,payload`,
        [namespace, event.eventId, event.cursor, JSON.stringify(event.payload)],
      );
      const row = inserted.rows[0];
      if (integer(row?.cursor ?? -1) !== event.cursor || canonicalJson(row?.payload) !== canonicalJson(event.payload))
        throw new Error('world event idempotency key payload conflict');
    }
    const received = Math.max(
      integer(state.received_through),
      page.coverage.returnedThrough,
      page.coverage.lostRange?.to ?? 0,
    );
    await client.query(
      `UPDATE ${schema}.workspace_state SET received_through=$2,updated_at=clock_timestamp() WHERE namespace=$1`,
      [namespace, received],
    );
    await client.query('COMMIT');
    return {
      receivedThrough: received,
      includedThrough: integer(state.included_through),
      compactedThrough: integer(state.compacted_through),
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function readWorkspaceEventCoverage(
  pool: Pool,
  schema: string,
  binding: WorkspaceBinding,
  after: number,
): Promise<readonly EventPageCoverage[]> {
  assertCursor(after, 'after');
  const result = await pool.query<{ coverage: EventPageCoverage }>(
    `SELECT coverage FROM ${schema}.event_pages
     WHERE namespace=$1 AND GREATEST(
       (coverage->>'returnedThrough')::bigint,
       COALESCE((coverage->'lostRange'->>'to')::bigint,0)
     ) > $2 ORDER BY created_at,page_id LIMIT 64`,
    [createWorkspaceNamespace(binding), after],
  );
  return result.rows.map((row) => row.coverage);
}

export async function getWorkspaceRuntimeMetadata(
  pool: Pool,
  schema: string,
  binding: WorkspaceBinding,
): Promise<CognitionRuntimeMetadata> {
  const result = await pool.query<{
    revision: number;
    snapshot: Record<string, unknown>;
    logical_rounds: string | number;
    compactions: string | number;
    updated_at: Date | string;
  }>(`SELECT * FROM ${schema}.runtime_metadata WHERE namespace=$1`, [createWorkspaceNamespace(binding)]);
  const row = result.rows[0];
  if (!row) throw new Error('workspace runtime metadata does not exist');
  return {
    revision: row.revision,
    snapshot: row.snapshot,
    logicalRounds: integer(row.logical_rounds),
    compactions: integer(row.compactions),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : new Date(row.updated_at).toISOString(),
  };
}

export async function setWorkspaceRuntimeMetadata(
  pool: Pool,
  schema: string,
  binding: WorkspaceBinding,
  input: Readonly<{
    expectedRevision: number;
    snapshot: Readonly<Record<string, unknown>>;
    logicalRounds: number;
    compactions: number;
  }>,
): Promise<CognitionRuntimeMetadata> {
  if (!Number.isInteger(input.expectedRevision) || input.expectedRevision < 1)
    throw new Error('invalid runtime metadata revision');
  if (!Number.isSafeInteger(input.logicalRounds) || input.logicalRounds < 0)
    throw new Error('invalid logical round count');
  if (!Number.isSafeInteger(input.compactions) || input.compactions < 0) throw new Error('invalid compaction count');
  const snapshot = serializeRuntimeSnapshot(input.snapshot);
  const result = await pool.query<{
    revision: number;
    snapshot: Record<string, unknown>;
    logical_rounds: string | number;
    compactions: string | number;
    updated_at: Date | string;
  }>(
    `UPDATE ${schema}.runtime_metadata SET revision=revision+1,snapshot=$3::jsonb,
       logical_rounds=$4,compactions=$5,updated_at=clock_timestamp()
     WHERE namespace=$1 AND revision=$2 RETURNING *`,
    [createWorkspaceNamespace(binding), input.expectedRevision, snapshot, input.logicalRounds, input.compactions],
  );
  if (!result.rows[0]) throw new Error('runtime metadata revision conflict');
  return getWorkspaceRuntimeMetadata(pool, schema, binding);
}
