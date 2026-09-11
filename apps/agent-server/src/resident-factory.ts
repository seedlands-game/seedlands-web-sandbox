import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage } from '@langchain/core/messages';
import type { ResidentBirthPackage, ResidentWorldBinding } from '@seedlands/cognition-protocol';
import { BEHAVIOR_TREE_AUTHORING_GUIDE } from '@seedlands/game-core/runtime/behavior-control-protocol';
import { Pool, type PoolClient } from 'pg';
import { createResidentBirthSchema, parseResidentBirthPackage } from './resident-birth-codec.js';

const MAX_BIRTHS_PER_TIMELINE = 64;
const MAX_TAGS = 12;
const DEFAULT_MODEL_TIMEOUT_MS = 315_000;
const BIRTH_SCHEMA = createResidentBirthSchema(BEHAVIOR_TREE_AUTHORING_GUIDE);

const boundedText = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && new TextEncoder().encode(value).byteLength <= maximum;
async function hash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function schemaSql(schema: string): string {
  if (!/^[a-z_][a-z0-9_]*$/u.test(schema)) throw new Error('invalid resident factory schema name');
  return `"${schema}"`;
}

function validateWorld(world: ResidentWorldBinding): void {
  if (![world.worldId, world.timelineId, world.epoch].every((value) => boundedText(value, 160)))
    throw new TypeError('Birth world binding is invalid.');
}

function validateTags(tags: readonly string[]): readonly string[] {
  if (!Array.isArray(tags) || tags.length > MAX_TAGS)
    throw new TypeError('Birth tags exceed the bounded factory input.');
  const result = tags.map((tag) => {
    if (!boundedText(tag, 80)) throw new TypeError('Birth tag is invalid.');
    return tag.trim();
  });
  if (new Set(result).size !== result.length) throw new TypeError('Birth tags must be unique.');
  return result;
}

export type ResidentFactoryOptions = Readonly<{
  pro: BaseChatModel;
  pool: Pool;
  schema?: string;
  ownsPool?: boolean;
  modelTimeoutMs?: number;
}>;

type InFlightBirth = {
  readonly tagsHash: string;
  readonly controller: AbortController;
  readonly promise: Promise<ResidentBirthPackage>;
  consumers: number;
  settled: boolean;
};

function abortReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new Error('Resident birth generation aborted.');
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw abortReason(signal);
}

async function waitWithSignal<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  throwIfAborted(signal);
  if (!signal) return await promise;
  return await new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', aborted);
    const aborted = () => {
      cleanup();
      reject(abortReason(signal));
    };
    signal.addEventListener('abort', aborted, { once: true });
    promise.then(
      (value) => {
        cleanup();
        resolve(value);
      },
      (error: unknown) => {
        cleanup();
        reject(error);
      },
    );
  });
}

/** Pro-only, PG-idempotent birth generator. Authority validates and activates the returned tree. */
export class ResidentFactory {
  private readonly schema: string;
  private readonly ownsPool: boolean;
  private readonly modelTimeoutMs: number;
  private readonly inFlight = new Map<string, InFlightBirth>();
  private closed = false;

  constructor(private readonly options: ResidentFactoryOptions) {
    this.schema = schemaSql(options.schema ?? 'npc_factory');
    this.ownsPool = options.ownsPool ?? false;
    this.modelTimeoutMs = options.modelTimeoutMs ?? DEFAULT_MODEL_TIMEOUT_MS;
    if (!Number.isSafeInteger(this.modelTimeoutMs) || this.modelTimeoutMs < 1 || this.modelTimeoutMs > 330_000)
      throw new Error('Invalid resident factory model timeout');
  }

  static open(
    options: Readonly<{ pro: BaseChatModel; connectionString: string; schema?: string; modelTimeoutMs?: number }>,
  ): ResidentFactory {
    if (!options.connectionString) throw new Error('resident factory connectionString is required');
    return new ResidentFactory({
      pro: options.pro,
      pool: new Pool({ connectionString: options.connectionString, max: 2 }),
      schema: options.schema,
      ownsPool: true,
      modelTimeoutMs: options.modelTimeoutMs,
    });
  }

  async setup(): Promise<void> {
    await this.options.pool.query(`CREATE SCHEMA IF NOT EXISTS ${this.schema}`);
    await this.options.pool.query(`
      CREATE TABLE IF NOT EXISTS ${this.schema}.birth_packages (
        world_id text NOT NULL, timeline_id text NOT NULL, birth_id text NOT NULL,
        tags_hash text NOT NULL, payload jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
        PRIMARY KEY (world_id,timeline_id,birth_id)
      )
    `);
  }

  async close(): Promise<void> {
    this.closed = true;
    const active = [...this.inFlight.values()];
    for (const operation of active) operation.controller.abort(new Error('Resident factory closed.'));
    await Promise.allSettled(active.map((operation) => operation.promise));
    if (this.ownsPool) await this.options.pool.end();
  }

  async generate(
    world: ResidentWorldBinding,
    birthId: string,
    rawTags: readonly string[],
    capabilities: unknown,
    signal?: AbortSignal,
  ): Promise<ResidentBirthPackage> {
    this.assertAvailable(signal);
    validateWorld(world);
    if (!boundedText(birthId, 160)) throw new TypeError('Birth request id is invalid.');
    const tags = validateTags(rawTags);
    const tagsHash = await hash({ tags, capabilities });
    const key = JSON.stringify([world.worldId, world.timelineId, birthId]);
    this.assertAvailable(signal);
    let operation = this.inFlight.get(key);
    if (operation) return await this.consume(operation, tagsHash, signal);
    const controller = new AbortController();
    const work = Promise.resolve().then(() =>
      this.generateClaimed(world, birthId, tags, tagsHash, capabilities, controller.signal),
    );
    const created: InFlightBirth = {
      tagsHash,
      controller,
      consumers: 0,
      settled: false,
      promise: work.finally(() => {
        created.settled = true;
        if (this.inFlight.get(key) === created) this.inFlight.delete(key);
      }),
    };
    operation = created;
    this.inFlight.set(key, operation);
    return await this.consume(operation, tagsHash, signal);
  }

  private async generateClaimed(
    world: ResidentWorldBinding,
    birthId: string,
    tags: readonly string[],
    tagsHash: string,
    capabilities: unknown,
    signal: AbortSignal,
  ): Promise<ResidentBirthPackage> {
    this.assertAvailable(signal);
    const existing = await this.read(world, birthId);
    this.assertAvailable(signal);
    if (existing) {
      if (existing.tagsHash !== tagsHash) throw new Error('Birth request id payload conflict.');
      return parseResidentBirthPackage(existing.payload, birthId, 'stored-package');
    }
    const count = await this.count(world);
    this.assertAvailable(signal);
    if (count >= MAX_BIRTHS_PER_TIMELINE) throw new RangeError('Resident factory birth budget exceeded.');
    return await this.generateAndPersist(world, birthId, tags, tagsHash, capabilities, signal);
  }

  private async consume(
    operation: InFlightBirth,
    tagsHash: string,
    signal?: AbortSignal,
  ): Promise<ResidentBirthPackage> {
    if (operation.tagsHash !== tagsHash) throw new Error('Birth request id payload conflict.');
    operation.consumers++;
    try {
      return await waitWithSignal(operation.promise, signal);
    } finally {
      operation.consumers--;
      if (operation.consumers === 0 && !operation.settled)
        operation.controller.abort(new Error('Resident birth request no longer has a consumer.'));
    }
  }

  private async generateAndPersist(
    world: ResidentWorldBinding,
    birthId: string,
    tags: readonly string[],
    tagsHash: string,
    capabilities: unknown,
    signal: AbortSignal,
  ): Promise<ResidentBirthPackage> {
    const generated = await this.createWithDeadline(tags, capabilities, birthId, signal);
    this.assertAvailable(signal);
    const client = await this.options.pool.connect();
    try {
      this.assertAvailable(signal);
      await client.query('BEGIN');
      this.assertAvailable(signal);
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        JSON.stringify([world.worldId, world.timelineId]),
      ]);
      this.assertAvailable(signal);
      const existing = await this.read(world, birthId, client);
      this.assertAvailable(signal);
      if (existing) {
        if (existing.tagsHash !== tagsHash) throw new Error('Birth request id payload conflict.');
        await client.query('COMMIT');
        return parseResidentBirthPackage(existing.payload, birthId, 'stored-package');
      }
      if ((await this.count(world, client)) >= MAX_BIRTHS_PER_TIMELINE)
        throw new RangeError('Resident factory birth budget exceeded.');
      this.assertAvailable(signal);
      await client.query(
        `INSERT INTO ${this.schema}.birth_packages(world_id,timeline_id,birth_id,tags_hash,payload)
         VALUES ($1,$2,$3,$4,$5::jsonb)`,
        [world.worldId, world.timelineId, birthId, tagsHash, JSON.stringify(generated)],
      );
      this.assertAvailable(signal);
      await client.query('COMMIT');
      return generated;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  private async read(world: ResidentWorldBinding, birthId: string, client?: PoolClient) {
    const queryable = client ?? this.options.pool;
    const result = await queryable.query<{ tags_hash: string; payload: unknown }>(
      `SELECT tags_hash,payload FROM ${this.schema}.birth_packages WHERE world_id=$1 AND timeline_id=$2 AND birth_id=$3`,
      [world.worldId, world.timelineId, birthId],
    );
    const row = result.rows[0];
    return row ? { tagsHash: row.tags_hash, payload: row.payload } : null;
  }

  private async count(world: ResidentWorldBinding, client?: PoolClient): Promise<number> {
    const queryable = client ?? this.options.pool;
    const count = await queryable.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM ${this.schema}.birth_packages WHERE world_id=$1 AND timeline_id=$2`,
      [world.worldId, world.timelineId],
    );
    return Number(count.rows[0]?.count ?? 0);
  }

  private assertAvailable(signal?: AbortSignal): void {
    if (this.closed) throw new Error('Resident factory is closed.');
    throwIfAborted(signal);
  }

  private async createWithDeadline(
    tags: readonly string[],
    capabilities: unknown,
    birthId: string,
    callerSignal: AbortSignal,
  ): Promise<ResidentBirthPackage> {
    const controller = new AbortController();
    const abortFromCaller = () => controller.abort(callerSignal.reason);
    callerSignal.addEventListener('abort', abortFromCaller, { once: true });
    const timeout = setTimeout(
      () => controller.abort(new Error('Resident birth model timed out.')),
      this.modelTimeoutMs,
    );
    if (callerSignal.aborted) controller.abort(callerSignal.reason);
    try {
      return await waitWithSignal(this.create(tags, capabilities, birthId, controller.signal), controller.signal);
    } finally {
      clearTimeout(timeout);
      callerSignal.removeEventListener('abort', abortFromCaller);
    }
  }

  private async create(
    tags: readonly string[],
    capabilities: unknown,
    birthId: string,
    signal?: AbortSignal,
  ): Promise<ResidentBirthPackage> {
    const structured = this.options.pro.withStructuredOutput(BIRTH_SCHEMA as never, {
      name: 'create_resident_birth_package',
      includeRaw: false,
    });
    const parsed = await structured.invoke(
      [
        new HumanMessage({
          content: JSON.stringify({
            task: 'Create one grounded resident birth package.',
            tags,
            capabilities,
            behaviorTreeAuthoringGuide: BEHAVIOR_TREE_AUTHORING_GUIDE,
            constraints: [
              'Use one version 1 behavior tree with stable node ids.',
              'Call create_resident_birth_package with the complete structured package.',
              'Use only condition and skill names present in the capability registry.',
              'No actor position is available before birth. Do not guess home, patrol, target, or other absolute coordinates.',
              'The initial tree may use only capabilities that do not require an absolute position; Authority observation can install positioned behavior later.',
              'Do not invent memories of events that have not happened.',
            ],
          }),
        }),
      ],
      { signal, reasoning_effort: 'low' } as never,
    );
    return parseResidentBirthPackage(parsed, birthId, 'model-output');
  }
}
