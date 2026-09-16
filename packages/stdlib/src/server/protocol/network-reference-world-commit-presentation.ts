import { CHUNK_SIZE, chunkKey } from '../../world/voxel';
import type { WorldCommitResult } from '../game-server-types';
import { compareChunkKeys } from '../world-transaction-commit';
import { canonicalReferenceInteger } from './network-reference-integer';

export const NETWORK_REFERENCE_WORLD_COMMIT_PRESENTATION_VERSION = 2 as const;

const MAX_STRUCTURAL_ENTRIES = 512;
const MAX_COLLISION_CELLS = CHUNK_SIZE ** 3;

type ChunkRevision = Readonly<{ key: string; revision: number }>;
type StructuralBounds = Readonly<{
  min: readonly [number, number, number];
  max: readonly [number, number, number];
}> | null;
type CollisionDelta = Readonly<{
  key: string;
  previousRevision: number;
  revision: number;
  cells: readonly Readonly<{ index: number; voxel: number; fluid: number }>[];
}>;

export type WorldCommitPresentationReference = Readonly<{
  kind: 'world-commit-presentation-reference';
  projectionVersion: typeof NETWORK_REFERENCE_WORLD_COMMIT_PRESENTATION_VERSION;
  epoch: string;
  publicationCommitSequenceUpperBound: number;
  causalCommitSequence: null;
  committed: boolean;
  worldRevision: number;
  structuralChange: Readonly<{
    presentationClass: 'fluid' | 'default';
    mutationCount: number;
    chunks: readonly string[];
    meshChunks: readonly string[];
    chunkRevisions: readonly ChunkRevision[];
    bounds: Readonly<{
      min: readonly [number, number, number];
      max: readonly [number, number, number];
    }> | null;
  }> | null;
  collisionDeltas: readonly CollisionDelta[];
}>;

function assertText(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} must be a non-empty string.`);
  return value;
}

function assertNonNegativeInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0)
    throw new TypeError(`${field} must be a non-negative safe integer.`);
  return canonicalReferenceInteger(value);
}

function assertSignedInteger(value: unknown, field: string): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new TypeError(`${field} must be a signed safe integer.`);
  return canonicalReferenceInteger(value);
}

function assertUnsignedInteger(value: unknown, maximum: number, field: string): number {
  const integer = assertNonNegativeInteger(value, field);
  if (integer > maximum) throw new RangeError(`${field} must not exceed ${maximum}.`);
  return integer;
}

function assertChunkKey(value: unknown, field: string): string {
  const key = assertText(value, field);
  const coordinates = key.split(',');
  if (coordinates.length !== 3) throw new TypeError(`${field} must be a canonical chunk key.`);
  const numeric = coordinates.map(Number);
  if (
    numeric.some((coordinate) => !Number.isSafeInteger(coordinate)) ||
    chunkKey(numeric[0]!, numeric[1]!, numeric[2]!) !== key
  )
    throw new TypeError(`${field} must be a canonical chunk key.`);
  return key;
}

function assertUnique(values: readonly string[], field: string): void {
  if (new Set(values).size !== values.length) throw new TypeError(`${field} must not contain duplicate keys.`);
}

function assertDenseArray(value: readonly unknown[], field: string): void {
  for (let index = 0; index < value.length; index += 1)
    if (!(index in value)) throw new TypeError(`${field} must be dense.`);
}

function projectKeys(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new TypeError(`${field} must be an array.`);
  assertDenseArray(value, field);
  if (value.length > MAX_STRUCTURAL_ENTRIES)
    throw new RangeError(`${field} must contain at most ${MAX_STRUCTURAL_ENTRIES} entries.`);
  const keys = value.map((key) => assertChunkKey(key, field));
  assertUnique(keys, field);
  return keys.sort(compareChunkKeys);
}

function projectChunkRevisions(value: unknown): ChunkRevision[] {
  if (!Array.isArray(value)) throw new TypeError('structural chunkRevisions must be an array.');
  assertDenseArray(value, 'structural chunkRevisions');
  if (value.length > MAX_STRUCTURAL_ENTRIES)
    throw new RangeError(`structural chunkRevisions must contain at most ${MAX_STRUCTURAL_ENTRIES} entries.`);
  const revisions = value.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new TypeError('structural chunk revision must be an object.');
    const candidate = entry as { key?: unknown; revision?: unknown };
    return {
      key: assertChunkKey(candidate.key, 'structural chunk revision key'),
      revision: assertNonNegativeInteger(candidate.revision, 'structural chunk revision'),
    };
  });
  assertUnique(
    revisions.map(({ key }) => key),
    'structural chunkRevisions',
  );
  return revisions.sort((left, right) => compareChunkKeys(left.key, right.key));
}

function projectBounds(value: unknown): StructuralBounds {
  if (value === null) return null;
  if (!value || typeof value !== 'object') throw new TypeError('structural bounds must be an object or null.');
  const candidate = value as { min?: unknown; max?: unknown };
  if (
    !Array.isArray(candidate.min) ||
    !Array.isArray(candidate.max) ||
    candidate.min.length !== 3 ||
    candidate.max.length !== 3
  )
    throw new TypeError('structural bounds must contain two three-coordinate tuples.');
  assertDenseArray(candidate.min, 'structural bounds.min');
  assertDenseArray(candidate.max, 'structural bounds.max');
  const min = candidate.min.map((coordinate, index) =>
    assertSignedInteger(coordinate, `structural bounds.min[${index}]`),
  ) as [number, number, number];
  const max = candidate.max.map((coordinate, index) =>
    assertSignedInteger(coordinate, `structural bounds.max[${index}]`),
  ) as [number, number, number];
  if (min.some((coordinate, index) => coordinate > max[index]!))
    throw new RangeError('structural bounds minimum must not exceed maximum.');
  return { min, max };
}

function projectCollisionDeltas(
  value: unknown,
  context: Readonly<{ committed: boolean; structuralChange: WorldCommitPresentationReference['structuralChange'] }>,
): CollisionDelta[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new TypeError('collisionDelta must be an array.');
  if (value.length === 0) return [];
  if (!context.committed || context.structuralChange === null)
    throw new TypeError('collisionDelta requires a committed structural change.');
  const structuralRevisions = context.structuralChange.chunkRevisions;
  assertDenseArray(value, 'collisionDelta');
  if (value.length > MAX_STRUCTURAL_ENTRIES)
    throw new RangeError(`collisionDelta must contain at most ${MAX_STRUCTURAL_ENTRIES} entries.`);
  const deltas = value.map((entry) => {
    if (!entry || typeof entry !== 'object') throw new TypeError('collision delta must be an object.');
    const candidate = entry as { key?: unknown; previousRevision?: unknown; revision?: unknown; cells?: unknown };
    if (!Array.isArray(candidate.cells)) throw new TypeError('collision delta cells must be an array.');
    assertDenseArray(candidate.cells, 'collision delta cells');
    if (candidate.cells.length === 0) throw new RangeError('collision delta cells must not be empty.');
    if (candidate.cells.length > MAX_COLLISION_CELLS)
      throw new RangeError(`collision delta cells must contain at most ${MAX_COLLISION_CELLS} entries.`);
    const cells = candidate.cells.map((cell) => {
      if (!cell || typeof cell !== 'object') throw new TypeError('collision delta cell must be an object.');
      const source = cell as { index?: unknown; voxel?: unknown; fluid?: unknown };
      const index = assertNonNegativeInteger(source.index, 'collision delta cell index');
      if (index >= MAX_COLLISION_CELLS) throw new RangeError('collision delta cell index is invalid.');
      return {
        index,
        voxel: assertUnsignedInteger(source.voxel, 0xffff, 'collision delta voxel'),
        fluid: assertUnsignedInteger(source.fluid, 0xff, 'collision delta fluid'),
      };
    });
    if (new Set(cells.map(({ index }) => index)).size !== cells.length)
      throw new TypeError('collision delta cells must not contain duplicate indexes.');
    const key = assertChunkKey(candidate.key, 'collision delta key');
    const previousRevision = assertNonNegativeInteger(candidate.previousRevision, 'collision delta previousRevision');
    const revision = assertNonNegativeInteger(candidate.revision, 'collision delta revision');
    if (previousRevision + 1 !== revision)
      throw new TypeError('collision delta revision must immediately follow previousRevision.');
    const chunkRevision = structuralRevisions.find((entry) => entry.key === key);
    if (!chunkRevision || chunkRevision.revision !== revision)
      throw new TypeError('collision delta key and revision must match a structural chunk revision.');
    return {
      key,
      previousRevision,
      revision,
      cells: cells.sort((left, right) => left.index - right.index),
    };
  });
  assertUnique(
    deltas.map(({ key }) => key),
    'collisionDelta',
  );
  return deltas.sort((left, right) => compareChunkKeys(left.key, right.key));
}

export function projectWorldCommitPresentationReference(
  commit: WorldCommitResult,
  context: Readonly<{ epoch: string; publicationCommitSequenceUpperBound: number }>,
): WorldCommitPresentationReference {
  const epoch = assertText(context.epoch, 'commit context epoch');
  const publicationCommitSequenceUpperBound = assertNonNegativeInteger(
    context.publicationCommitSequenceUpperBound,
    'commit context publicationCommitSequenceUpperBound',
  );
  if (typeof commit.committed !== 'boolean') throw new TypeError('commit.committed must be boolean.');
  const worldRevision = assertNonNegativeInteger(commit.worldRevision, 'commit.worldRevision');
  const structural = commit.structuralChange;
  const structuralChange: WorldCommitPresentationReference['structuralChange'] = structural
    ? (() => {
        if (structural.type !== 'voxel-region-changed') throw new TypeError('structural change type is invalid.');
        if (!commit.committed) throw new TypeError('structural change requires a committed result.');
        if (assertNonNegativeInteger(structural.worldRevision, 'structural worldRevision') !== worldRevision)
          throw new TypeError('structural worldRevision must equal commit.worldRevision.');
        const mutationCount = assertNonNegativeInteger(structural.mutationCount, 'structural mutationCount');
        if (mutationCount === 0) throw new RangeError('structural mutationCount must be greater than zero.');
        const chunks = projectKeys(structural.chunks, 'structural chunks');
        const meshChunks = projectKeys(structural.meshChunks, 'structural meshChunks');
        if (chunks.length === 0) throw new RangeError('structural chunks must not be empty.');
        if (chunks.some((key) => !meshChunks.includes(key)))
          throw new TypeError('structural meshChunks must include every canonical chunk.');
        const chunkRevisions = projectChunkRevisions(structural.chunkRevisions);
        const revisionKeys = chunkRevisions.map(({ key }) => key);
        if (chunks.length !== revisionKeys.length || chunks.some((key, index) => key !== revisionKeys[index]))
          throw new TypeError('structural chunks and chunkRevisions must have the same key set.');
        const bounds = projectBounds(structural.bounds);
        if (typeof structural.actorId !== 'string') throw new TypeError('structural actorId must be text.');
        const presentationClass = structural.actorId === 'fluid-v2' ? 'fluid' : 'default';
        if (presentationClass === 'fluid' && bounds === null)
          throw new TypeError('fluid structural change requires bounds.');
        return { presentationClass, mutationCount, chunks, meshChunks, chunkRevisions, bounds };
      })()
    : null;
  return {
    kind: 'world-commit-presentation-reference',
    projectionVersion: NETWORK_REFERENCE_WORLD_COMMIT_PRESENTATION_VERSION,
    epoch,
    publicationCommitSequenceUpperBound,
    causalCommitSequence: null,
    committed: commit.committed,
    worldRevision,
    structuralChange,
    collisionDeltas: projectCollisionDeltas(commit.collisionDelta, { committed: commit.committed, structuralChange }),
  };
}
