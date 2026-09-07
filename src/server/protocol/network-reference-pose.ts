import type { AuthoritySnapshot } from '../authority/authority-session-types';
import { NETWORK_REFERENCE_PROJECTION_VERSION, type ReferenceVector3 } from './network-reference-projection-types';

const MAX_ENTITY_POSES = 256;
const ENTITY_TYPES = new Set(['player', 'world-item', 'creature', 'npc']);
const ACTOR_ARCHETYPES = new Set(['grazer', 'night-stalker', 'settler']);

type EntityPoseType = AuthoritySnapshot['entities'][number]['type'];
type EntityPoseArchetype = NonNullable<AuthoritySnapshot['entities'][number]['archetype']>;

export type EntityPoseReference = {
  id: string;
  type: EntityPoseType;
  archetype?: EntityPoseArchetype;
  position: ReferenceVector3;
  velocity: ReferenceVector3;
  grounded: boolean;
};

export type EntityPosePublicationReference = {
  kind: 'entity-pose-reference';
  projectionVersion: typeof NETWORK_REFERENCE_PROJECTION_VERSION;
  epoch: string;
  /** 由发布适配器提供；调用方在封套/语料来源中绑定发布者及计数范围，不是快照或传输固有序号。 */
  publicationSequence: number;
  physicsTick: number;
  commitSequence: number;
  worldRevision: number;
  entities: EntityPoseReference[];
};

const nonEmptyText = (value: unknown, field: string): string => {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} must be a non-empty string.`);
  return value;
};

const nonNegativeSafeInteger = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`${field} must be a non-negative safe integer.`);
  return value;
};

const finite = (value: unknown, field: string): number => {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError(`${field} must be finite.`);
  return value;
};

const vector = (value: unknown, field: string): ReferenceVector3 => {
  if (!value || typeof value !== 'object') throw new TypeError(`${field} must be a vector.`);
  const candidate = value as Record<string, unknown>;
  return {
    x: finite(candidate.x, `${field}.x`),
    y: finite(candidate.y, `${field}.y`),
    z: finite(candidate.z, `${field}.z`),
  };
};

const entityType = (value: unknown): EntityPoseType => {
  if (typeof value !== 'string' || !ENTITY_TYPES.has(value)) throw new TypeError('entity.type is invalid.');
  return value as EntityPoseType;
};

const entityArchetype = (type: EntityPoseType, value: unknown): EntityPoseArchetype | undefined => {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !ACTOR_ARCHETYPES.has(value)) throw new TypeError('entity.archetype is invalid.');
  if (type === 'npc' && value !== 'settler') throw new TypeError('NPC entity archetype must be settler.');
  if (type === 'creature' && value === 'settler') throw new TypeError('Creature entity archetype cannot be settler.');
  if (type !== 'npc' && type !== 'creature') throw new TypeError(`${type} entity cannot have an archetype.`);
  return value as EntityPoseArchetype;
};

const projectEntity = (source: AuthoritySnapshot['entities'][number]): EntityPoseReference => {
  const id = nonEmptyText(source.id, 'entity.id');
  const type = entityType(source.type);
  const archetype = entityArchetype(type, source.archetype);
  if (typeof source.grounded !== 'boolean') throw new TypeError('entity.grounded must be boolean.');
  return {
    id,
    type,
    ...(archetype === undefined ? {} : { archetype }),
    position: vector(source.body?.position, 'entity.body.position'),
    velocity: vector(source.body?.velocity, 'entity.body.velocity'),
    grounded: source.grounded,
  };
};

const compareIds = (left: EntityPoseReference, right: EntityPoseReference) =>
  left.id < right.id ? -1 : left.id > right.id ? 1 : 0;

export function projectEntityPoseReference(
  snapshot: AuthoritySnapshot,
  context: Readonly<{ publicationSequence: number }>,
): EntityPosePublicationReference {
  if (!Array.isArray(snapshot.entities)) throw new TypeError('snapshot.entities must be an array.');
  if (snapshot.entities.length > MAX_ENTITY_POSES)
    throw new RangeError(`snapshot.entities must contain at most ${MAX_ENTITY_POSES} entities.`);

  const entities = snapshot.entities.map(projectEntity);
  const ids = new Set<string>();
  for (const entity of entities) {
    if (ids.has(entity.id)) throw new TypeError(`Duplicate entity id: ${entity.id}`);
    ids.add(entity.id);
  }
  entities.sort(compareIds);

  return {
    kind: 'entity-pose-reference',
    projectionVersion: NETWORK_REFERENCE_PROJECTION_VERSION,
    epoch: nonEmptyText(snapshot.epoch, 'snapshot.epoch'),
    publicationSequence: nonNegativeSafeInteger(context.publicationSequence, 'context.publicationSequence'),
    physicsTick: nonNegativeSafeInteger(snapshot.physicsTick, 'snapshot.physicsTick'),
    commitSequence: nonNegativeSafeInteger(snapshot.commitSequence, 'snapshot.commitSequence'),
    worldRevision: nonNegativeSafeInteger(snapshot.worldRevision, 'snapshot.worldRevision'),
    entities,
  };
}
