import type { AuthoritySnapshot } from '../authority/authority-session-types';
import type { WorldCommitResult } from '../game-server-types';
import type { AuthorityGameplayView } from '../../worker/authority-worker-protocol';
import { CHUNK_SIZE } from '../../world/voxel';
import {
  NETWORK_REFERENCE_PROJECTION_VERSION,
  type GameplayBreakActionReference,
  type GameplayEntityReference,
  type GameplayInventorySlotReference,
  type GameplayPlayerReference,
  type GameplayViewReference,
  type PlayerCorrectionReference,
  type ReferenceVector3,
  type WorldCommitReference,
} from './network-reference-projection-types';
import { canonicalReferenceInteger } from './network-reference-integer';

export { NETWORK_REFERENCE_PROJECTION_VERSION } from './network-reference-projection-types';
export type * from './network-reference-projection-types';

const MAX_COLLISION_CELL_INDEX = CHUNK_SIZE ** 3;
const allowedArchetypes = new Set(['grazer', 'night-stalker', 'settler']);
const isPresentationEntityType = (value: string): value is GameplayEntityReference['type'] =>
  value === 'world-item' || value === 'creature' || value === 'npc';

const assertFinite = (value: number, field: string) => {
  if (!Number.isFinite(value)) throw new TypeError(`${field} must be finite.`);
  return value;
};
const assertNonNegativeInteger = (value: number, field: string) => {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${field} must be a non-negative safe integer.`);
  return canonicalReferenceInteger(value);
};
const assertText = (value: string, field: string) => {
  if (typeof value !== 'string' || !value.trim()) throw new TypeError(`${field} must be a non-empty string.`);
  return value;
};
const vector = (value: Readonly<{ x: number; y: number; z: number }>, field: string): ReferenceVector3 => ({
  x: assertFinite(value.x, `${field}.x`),
  y: assertFinite(value.y, `${field}.y`),
  z: assertFinite(value.z, `${field}.z`),
});
const tuple = (value: readonly number[], field: string): [number, number, number] => {
  if (value.length !== 3) throw new TypeError(`${field} must have three coordinates.`);
  return [
    assertFinite(value[0], `${field}[0]`),
    assertFinite(value[1], `${field}[1]`),
    assertFinite(value[2], `${field}[2]`),
  ];
};
export function projectPlayerCorrectionReference(snapshot: AuthoritySnapshot): PlayerCorrectionReference {
  assertText(snapshot.epoch, 'snapshot.epoch');
  const physicsTick = assertNonNegativeInteger(snapshot.physicsTick, 'snapshot.physicsTick');
  const commitSequence = assertNonNegativeInteger(snapshot.commitSequence, 'snapshot.commitSequence');
  const worldRevision = assertNonNegativeInteger(snapshot.worldRevision, 'snapshot.worldRevision');
  if (!Number.isSafeInteger(snapshot.acknowledgedInputSequence) || snapshot.acknowledgedInputSequence < -1)
    throw new TypeError('snapshot.acknowledgedInputSequence must be a safe integer greater than or equal to -1.');
  const acknowledgedInputSequence = canonicalReferenceInteger(snapshot.acknowledgedInputSequence);
  const collisionRevisions = Object.entries(snapshot.chunkRevisions)
    .map(([key, revision]) => ({
      key: assertText(key, 'snapshot.chunkRevisions key'),
      revision: assertNonNegativeInteger(revision, 'chunk revision'),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
  return {
    kind: 'player-correction-reference',
    projectionVersion: NETWORK_REFERENCE_PROJECTION_VERSION,
    epoch: snapshot.epoch,
    physicsTick,
    commitSequence,
    worldRevision,
    worldTime: assertFinite(snapshot.worldTime, 'snapshot.worldTime'),
    acknowledgedInputSequence,
    inputResyncRequired: snapshot.inputResyncRequired,
    paused: snapshot.paused,
    player: {
      id: assertText(snapshot.player.id, 'snapshot.player.id'),
      position: vector(snapshot.player.body.position, 'snapshot.player.body.position'),
      velocity: vector(snapshot.player.body.velocity, 'snapshot.player.body.velocity'),
      grounded: snapshot.player.grounded,
    },
    collisionRevisions,
  };
}

const projectInventory = (inventory: AuthorityGameplayView['player']['inventory']): GameplayInventorySlotReference[] =>
  inventory.map((slot, index) => {
    if (slot === null) return null;
    return {
      slot: canonicalReferenceInteger(index),
      itemId: assertText(slot.itemId, `inventory[${index}].itemId`),
      count: assertNonNegativeInteger(slot.count, `inventory[${index}].count`),
    };
  });
const projectBreakAction = (value: AuthorityGameplayView['player']['breakAction']): GameplayBreakActionReference => {
  if (!value) return null;
  return {
    position: tuple(value.position, 'breakAction.position'),
    voxel: assertNonNegativeInteger(value.voxel, 'breakAction.voxel'),
    elapsedSeconds: assertFinite(value.elapsedSeconds, 'breakAction.elapsedSeconds'),
    requiredSeconds: assertFinite(value.requiredSeconds, 'breakAction.requiredSeconds'),
  };
};
const projectPlayer = (value: AuthorityGameplayView['player']): GameplayPlayerReference => ({
  entityId: assertText(value.entityId, 'gameplay.player.entityId'),
  health: assertFinite(value.health, 'gameplay.player.health'),
  maxHealth: assertFinite(value.maxHealth, 'gameplay.player.maxHealth'),
  hunger: assertFinite(value.hunger, 'gameplay.player.hunger'),
  maxHunger: assertFinite(value.maxHunger, 'gameplay.player.maxHunger'),
  lifecycle: value.lifecycle,
  inventory: projectInventory(value.inventory),
  selectedSlot: assertNonNegativeInteger(value.selectedSlot, 'gameplay.player.selectedSlot'),
  hotbarSize: assertNonNegativeInteger(value.hotbarSize, 'gameplay.player.hotbarSize'),
  breakAction: projectBreakAction(value.breakAction),
});
const projectEntity = (value: AuthorityGameplayView['entities'][number]): GameplayEntityReference => {
  if (!isPresentationEntityType(value.type))
    throw new TypeError(`Entity type ${value.type} is not a presentation entity.`);
  if (value.archetype && !allowedArchetypes.has(value.archetype))
    throw new TypeError(`Unsupported entity archetype ${value.archetype}.`);
  if (value.type === 'npc' && value.archetype && value.archetype !== 'settler')
    throw new TypeError('NPC presentation archetype must be settler.');
  if (value.type === 'creature' && value.archetype === 'settler')
    throw new TypeError('Creature presentation archetype cannot be settler.');
  const projected: GameplayEntityReference = {
    id: assertText(value.id, 'entity.id'),
    type: value.type,
    position: tuple(value.position, 'entity.position'),
    ...(value.archetype ? { archetype: value.archetype } : {}),
    ...(value.health === undefined ? {} : { health: assertFinite(value.health, 'entity.health') }),
    ...(value.maxHealth === undefined ? {} : { maxHealth: assertFinite(value.maxHealth, 'entity.maxHealth') }),
  };
  if (value.stack) {
    if (value.type !== 'world-item') throw new TypeError('Only world-item presentation entities may contain a stack.');
    projected.stack = {
      itemId: assertText(value.stack.itemId, 'entity.stack.itemId'),
      count: assertNonNegativeInteger(value.stack.count, 'entity.stack.count'),
    };
  }
  return projected;
};

export function projectGameplayViewReference(
  view: AuthorityGameplayView,
  context: Readonly<{
    epoch: string;
    snapshotPhysicsTick: number;
    snapshotCommitSequence: number;
    snapshotWorldRevision: number;
  }>,
): GameplayViewReference {
  assertText(context.epoch, 'gameplay context epoch');
  const snapshotPhysicsTick = assertNonNegativeInteger(
    context.snapshotPhysicsTick,
    'gameplay context snapshotPhysicsTick',
  );
  const snapshotCommitSequence = assertNonNegativeInteger(
    context.snapshotCommitSequence,
    'gameplay context snapshotCommitSequence',
  );
  const snapshotWorldRevision = assertNonNegativeInteger(
    context.snapshotWorldRevision,
    'gameplay context snapshotWorldRevision',
  );
  const gameplayRevision = assertNonNegativeInteger(view.gameplayRevision, 'gameplayRevision');
  assertFinite(view.gameplayTime, 'gameplayTime');
  const entities = view.entities
    .filter((entity) => entity.type !== 'player')
    .map(projectEntity)
    .sort((left, right) => left.id.localeCompare(right.id));
  const craftableRecipeIds = view.craftableRecipeIds.map((id) => assertText(id, 'craftableRecipeId'));
  if (new Set(craftableRecipeIds).size !== craftableRecipeIds.length)
    throw new TypeError('craftableRecipeIds must be unique.');
  return {
    kind: 'gameplay-view-reference',
    projectionVersion: NETWORK_REFERENCE_PROJECTION_VERSION,
    epoch: context.epoch,
    snapshotPhysicsTick,
    snapshotCommitSequence,
    snapshotWorldRevision,
    gameplayRevision,
    gameplayTime: view.gameplayTime,
    player: projectPlayer(view.player),
    craftableRecipeIds: [...craftableRecipeIds],
    entities,
  };
}

export function projectWorldCommitReference(
  commit: WorldCommitResult,
  context: Readonly<{ epoch: string; publicationCommitSequenceUpperBound: number }>,
): WorldCommitReference {
  assertText(context.epoch, 'commit context epoch');
  const publicationCommitSequenceUpperBound = assertNonNegativeInteger(
    context.publicationCommitSequenceUpperBound,
    'commit context publicationCommitSequenceUpperBound',
  );
  const worldRevision = assertNonNegativeInteger(commit.worldRevision, 'commit.worldRevision');
  const structuralChange = commit.structuralChange
    ? {
        chunks: [...commit.structuralChange.chunks].map((key) => assertText(key, 'structural chunk key')).sort(),
        chunkRevisions: commit.structuralChange.chunkRevisions
          .map(({ key, revision }) => ({
            key: assertText(key, 'structural chunk revision key'),
            revision: assertNonNegativeInteger(revision, 'structural chunk revision'),
          }))
          .sort((left, right) => left.key.localeCompare(right.key)),
      }
    : null;
  const collisionDeltas = (commit.collisionDelta ?? [])
    .map((delta) => ({
      key: assertText(delta.key, 'collision delta key'),
      previousRevision: assertNonNegativeInteger(delta.previousRevision, 'collision delta previousRevision'),
      revision: assertNonNegativeInteger(delta.revision, 'collision delta revision'),
      cells: delta.cells.map((cell) => {
        if (!Number.isSafeInteger(cell.index) || cell.index < 0 || cell.index >= MAX_COLLISION_CELL_INDEX)
          throw new TypeError('collision delta cell index is invalid.');
        return {
          index: canonicalReferenceInteger(cell.index),
          voxel: assertNonNegativeInteger(cell.voxel, 'collision delta voxel'),
          fluid: assertNonNegativeInteger(cell.fluid, 'collision delta fluid'),
        };
      }),
    }))
    .sort((left, right) => left.key.localeCompare(right.key));
  return {
    kind: 'world-commit-reference',
    projectionVersion: NETWORK_REFERENCE_PROJECTION_VERSION,
    epoch: context.epoch,
    publicationCommitSequenceUpperBound,
    causalCommitSequence: null,
    committed: commit.committed,
    worldRevision,
    structuralChange,
    collisionDeltas,
  };
}
