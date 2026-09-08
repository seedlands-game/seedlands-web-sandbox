/**
 * Codec- and transport-neutral reference DTOs derived from current authority outputs.
 * They are not the versioned public network wire contract.
 */
export const NETWORK_REFERENCE_PROJECTION_VERSION = 1 as const;

export type ReferenceVector3 = { x: number; y: number; z: number };
export type ReferenceChunkRevision = { key: string; revision: number };

export type PlayerCorrectionReference = {
  kind: 'player-correction-reference';
  projectionVersion: typeof NETWORK_REFERENCE_PROJECTION_VERSION;
  epoch: string;
  physicsTick: number;
  commitSequence: number;
  worldRevision: number;
  /** Browser environment consumes this for the authoritative day/night state. */
  worldTime: number;
  acknowledgedInputSequence: number;
  inputResyncRequired: boolean;
  paused: boolean;
  player: { id: string; position: ReferenceVector3; velocity: ReferenceVector3; grounded: boolean };
  collisionRevisions: ReferenceChunkRevision[];
};

export type GameplayInventorySlotReference = { slot: number; itemId: string; count: number } | null;
export type GameplayBreakActionReference = {
  position: [number, number, number];
  voxel: number;
  elapsedSeconds: number;
  requiredSeconds: number;
} | null;
export type GameplayPlayerReference = {
  entityId: string;
  health: number;
  maxHealth: number;
  hunger: number;
  maxHunger: number;
  lifecycle: 'alive' | 'dead';
  inventory: GameplayInventorySlotReference[];
  selectedSlot: number;
  hotbarSize: number;
  breakAction: GameplayBreakActionReference;
};
export type GameplayEntityReference = {
  id: string;
  type: 'world-item' | 'creature' | 'npc';
  position: [number, number, number];
  archetype?: 'grazer' | 'night-stalker' | 'settler';
  stack?: { itemId: string; count: number };
  health?: number;
  maxHealth?: number;
};
export type GameplayViewReference = {
  kind: 'gameplay-view-reference';
  projectionVersion: typeof NETWORK_REFERENCE_PROJECTION_VERSION;
  /** Links this view to the snapshot publication that supplied its authority boundary. */
  epoch: string;
  snapshotPhysicsTick: number;
  snapshotCommitSequence: number;
  snapshotWorldRevision: number;
  gameplayRevision: number;
  gameplayTime: number;
  player: GameplayPlayerReference;
  craftableRecipeIds: string[];
  entities: GameplayEntityReference[];
};

export type WorldCommitDeltaReference = {
  key: string;
  previousRevision: number;
  revision: number;
  cells: Array<{ index: number; voxel: number; fluid: number }>;
};
export type WorldCommitReference = {
  kind: 'world-commit-reference';
  projectionVersion: typeof NETWORK_REFERENCE_PROJECTION_VERSION;
  epoch: string;
  /**
   * The enclosing snapshot's sequence is only an upper bound. WorldCommitResult
   * does not expose an exact authority commit sequence for this individual commit.
   */
  publicationCommitSequenceUpperBound: number;
  /** Kept explicit so consumers cannot treat the upper bound as an exact causal id. */
  causalCommitSequence: null;
  committed: boolean;
  worldRevision: number;
  structuralChange: { chunks: string[]; chunkRevisions: ReferenceChunkRevision[] } | null;
  collisionDeltas: WorldCommitDeltaReference[];
};
