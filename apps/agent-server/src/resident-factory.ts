import type { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage } from '@langchain/core/messages';
import type { ResidentBirthPackage, ResidentWorldBinding } from '@seedlands/cognition-protocol';
import { BEHAVIOR_TREE_AUTHORING_GUIDE } from '@seedlands/game-core/runtime/behavior-control-protocol';
import { Pool, type PoolClient } from 'pg';

const MAX_BIRTHS_PER_TIMELINE = 64;
const MAX_TAGS = 12;
const BIRTH_SCHEMA = {
  type: 'object',
  properties: {
    profile: {
      type: 'object',
      properties: {
        name: { type: 'string', minLength: 1, maxLength: 48 },
        personality: { type: 'string', minLength: 1, maxLength: 400 },
        background: { type: 'string', maxLength: 800 },
        riskTolerance: { type: 'number', minimum: 0, maximum: 1 },
      },
      required: ['name', 'personality'],
      additionalProperties: false,
    },
    soul: { type: 'string', minLength: 1, maxLength: 4000 },
    agent: { type: 'string', minLength: 1, maxLength: 4000 },
    memory: { type: 'string', minLength: 1, maxLength: 4000 },
    goal: {
      type: 'object',
      properties: { description: { type: 'string', minLength: 1, maxLength: 2000 } },
      required: ['description'],
    },
    definition: { type: 'object', description: BEHAVIOR_TREE_AUTHORING_GUIDE },
  },
  required: ['profile', 'agent', 'soul', 'memory', 'goal', 'definition'],
  additionalProperties: false,
} as const;

const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const boundedText = (value: unknown, maximum: number): value is string =>
  typeof value === 'string' && value.trim().length > 0 && new TextEncoder().encode(value).byteLength <= maximum;
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
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

function validateBirth(value: unknown, birthId: string): ResidentBirthPackage {
  if (!object(value) || !object(value.profile) || !object(value.goal) || !object(value.definition))
    throw new TypeError('Pro birth package is invalid.');
  const profile = value.profile;
  if (!boundedText(profile.name, 192) || !boundedText(profile.personality, 1600))
    throw new TypeError('Pro birth profile is invalid.');
  if (
    profile.background !== undefined &&
    (typeof profile.background !== 'string' || new TextEncoder().encode(profile.background).byteLength > 3200)
  )
    throw new TypeError('Pro birth background is invalid.');
  if (
    profile.riskTolerance !== undefined &&
    (typeof profile.riskTolerance !== 'number' || profile.riskTolerance < 0 || profile.riskTolerance > 1)
  )
    throw new TypeError('Pro birth risk tolerance is invalid.');
  if (
    !boundedText(value.agent, 4 * 1024) ||
    !boundedText(value.soul, 4 * 1024) ||
    !boundedText(value.memory, 16 * 1024) ||
    !boundedText(value.goal.description, 8 * 1024)
  )
    throw new TypeError('Pro birth documents are invalid.');
  const definition = value.definition;
  if (
    definition.version !== 1 ||
    !object(definition.root) ||
    new TextEncoder().encode(JSON.stringify(definition)).byteLength > 32 * 1024
  )
    throw new TypeError('Pro birth behavior is invalid.');
  const birth = clone({
    birthId,
    profile: profile as ResidentBirthPackage['profile'],
    agent: value.agent,
    soul: value.soul,
    memory: value.memory,
    goal: value.goal as ResidentBirthPackage['goal'],
    definition: definition as ResidentBirthPackage['definition'],
  });
  return birth as ResidentBirthPackage;
}

export type ResidentFactoryOptions = Readonly<{
  pro: BaseChatModel;
  pool: Pool;
  schema?: string;
  ownsPool?: boolean;
}>;

/** Pro-only, PG-idempotent birth generator. Authority validates and activates the returned tree. */
export class ResidentFactory {
  private readonly schema: string;
  private readonly ownsPool: boolean;

  constructor(private readonly options: ResidentFactoryOptions) {
    this.schema = schemaSql(options.schema ?? 'npc_factory');
    this.ownsPool = options.ownsPool ?? false;
  }

  static open(options: Readonly<{ pro: BaseChatModel; connectionString: string; schema?: string }>): ResidentFactory {
    if (!options.connectionString) throw new Error('resident factory connectionString is required');
    return new ResidentFactory({
      pro: options.pro,
      pool: new Pool({ connectionString: options.connectionString, max: 2 }),
      schema: options.schema,
      ownsPool: true,
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
    if (this.ownsPool) await this.options.pool.end();
  }

  async generate(
    world: ResidentWorldBinding,
    birthId: string,
    rawTags: readonly string[],
    capabilities: unknown,
    signal?: AbortSignal,
  ): Promise<ResidentBirthPackage> {
    validateWorld(world);
    if (!boundedText(birthId, 160)) throw new TypeError('Birth request id is invalid.');
    const tags = validateTags(rawTags);
    const tagsHash = await hash({ tags, capabilities });
    const client = await this.options.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [
        JSON.stringify([world.worldId, world.timelineId]),
      ]);
      const existing = await this.read(world, birthId, client);
      if (existing) {
        if (existing.tagsHash !== tagsHash) throw new Error('Birth request id payload conflict.');
        await client.query('COMMIT');
        return validateBirth(existing.payload, birthId);
      }
      const count = await client.query<{ count: string }>(
        `SELECT count(*)::text AS count FROM ${this.schema}.birth_packages WHERE world_id=$1 AND timeline_id=$2`,
        [world.worldId, world.timelineId],
      );
      if (Number(count.rows[0]?.count ?? 0) >= MAX_BIRTHS_PER_TIMELINE)
        throw new RangeError('Resident factory birth budget exceeded.');
      const generated = await this.create(tags, capabilities, birthId, signal);
      await client.query(
        `INSERT INTO ${this.schema}.birth_packages(world_id,timeline_id,birth_id,tags_hash,payload)
         VALUES ($1,$2,$3,$4,$5::jsonb)`,
        [world.worldId, world.timelineId, birthId, tagsHash, JSON.stringify(generated)],
      );
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
      { signal },
    );
    return validateBirth(parsed, birthId);
  }
}
