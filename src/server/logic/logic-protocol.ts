import type { BodyKind } from '../../physics/body-registry';
import type { ActorAction } from '../simulation/action-runtime';
import type { ActorState } from '../simulation/actor-state';
import type { PoiSnapshot } from '../simulation/poi-registry';

export const LOGIC_PROTOCOL_VERSION = 1 as const;
export const LOGIC_INTENT_TTL_MS = 200;
export const MAX_LOGIC_TERRAIN_AXIS = 32;
export const MAX_LOGIC_TERRAIN_CELLS = 32_768;

export type LogicPosition = [number, number, number];

export type ActorActionSnapshot = Readonly<ActorAction>;

export type LogicEntity = Readonly<{
  id: string;
  bodyKind: BodyKind;
  identityRevision: number;
  poseRevision: number;
  position: LogicPosition;
  velocity: LogicPosition;
  grounded: boolean;
  health?: number;
  stack?: Readonly<{ itemId: string; count: number; edible: boolean; hungerRestore: number }>;
}>;

export type TerrainWindow = Readonly<{
  key: string;
  chunkRevision: number;
  origin: LogicPosition;
  size: LogicPosition;
  occupancy: Uint8Array;
}>;

export type LogicObservation = Readonly<{
  protocolVersion: typeof LOGIC_PROTOCOL_VERSION;
  epoch: string;
  observationSequence: number;
  physicsTick: number;
  activeTimeMs: number;
  worldTime: number;
  entities: readonly LogicEntity[];
  decisionContext: Readonly<{
    actors: readonly Readonly<{
      state: ActorState;
      identityRevision: number;
      activeAction: ActorActionSnapshot | null;
    }>[];
    pois: PoiSnapshot;
    terrainWindows: readonly TerrainWindow[];
  }>;
}>;

export type LogicIntentAction =
  | Readonly<{ type: 'attack'; targetId: string }>
  | Readonly<{ type: 'move-to'; target: LogicPosition }>
  | Readonly<{ type: 'consume-world-item'; targetId: string }>
  | Readonly<{ type: 'start-existing-action'; actionId: string }>;

export type LogicIntent = Readonly<{
  entityId: string;
  identityRevision: number;
  observedPoseRevision: number;
  readChunkRevisions: readonly Readonly<{ key: string; revision: number }>[];
  wish: Readonly<{ x: number; z: number }>;
  jumpRequested: boolean;
  verticalIntent: -1 | 0 | 1;
  action?: LogicIntentAction;
}>;

export type LogicIntentBatch = Readonly<{
  protocolVersion: typeof LOGIC_PROTOCOL_VERSION;
  epoch: string;
  observationSequence: number;
  expiresAtPhysicsTick: number;
  intents: readonly LogicIntent[];
}>;

export type LogicWorkerRequest =
  | Readonly<{
      kind: 'init-logic';
      protocolVersion: typeof LOGIC_PROTOCOL_VERSION;
      epoch: string;
      harnessEnabled: boolean;
      physicsHz: 30 | 60 | 120;
    }>
  | Readonly<{
      kind: 'logic-observation';
      protocolVersion: typeof LOGIC_PROTOCOL_VERSION;
      observation: LogicObservation;
    }>
  | Readonly<{
      kind: 'block-for-test';
      protocolVersion: typeof LOGIC_PROTOCOL_VERSION;
      epoch: string;
      ms: number;
    }>
  | Readonly<{
      kind: 'dispose-logic';
      protocolVersion: typeof LOGIC_PROTOCOL_VERSION;
      epoch: string;
    }>;

export type LogicWorkerResponse =
  | Readonly<{
      kind: 'logic-ready';
      protocolVersion: typeof LOGIC_PROTOCOL_VERSION;
      epoch: string;
    }>
  | Readonly<{
      kind: 'logic-intents';
      protocolVersion: typeof LOGIC_PROTOCOL_VERSION;
      batch: LogicIntentBatch;
    }>
  | Readonly<{
      kind: 'logic-fatal';
      protocolVersion: typeof LOGIC_PROTOCOL_VERSION;
      epoch: string;
      error: string;
    }>;
