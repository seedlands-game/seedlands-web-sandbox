import type { EntityLifetimeReference } from '../gameplay/entity-store';
import type { BodyState, Contact } from '../../physics';
import type { CostSampleWindow } from '../../runtime/bounded-cost-samples';
import type { FluidAuthorityDiagnostics } from '../fluid/fluid-transaction';
import type { AuthorityResidencyDiagnostics } from './authority-residency-runtime';

export type AuthorityEntity = Readonly<{
  id: string;
  type: 'player' | 'world-item' | 'creature' | 'npc';
  archetype?: 'grazer' | 'night-stalker' | 'settler';
  position: [number, number, number];
  physicsVelocity?: [number, number, number];
}>;

export type AuthorityPickupTarget = Readonly<{
  id: string;
  position: [number, number, number];
}>;

export type AuthorityActorModeState = Readonly<{
  mode: 'survival' | 'creative';
  modeRevision?: number;
  flight: Readonly<{ enabled: boolean; revision?: number }>;
}>;

export type AuthorityServerPort = {
  readonly worldRevision: number;
  readonly mutationCount: number;
  readonly worldTime: number;
  readonly fluidDiagnostics?: FluidAuthorityDiagnostics;
  getEntity: (id: string) => AuthorityEntity | null;
  getActorModeState?: (id: string) => AuthorityActorModeState | null;
  createEntityReference?: (id: string) => EntityLifetimeReference | null;
  resolveEntityReference?: (reference: EntityLifetimeReference) => boolean;
  queryEntities: () => AuthorityEntity[];
  updateEntity: (
    id: string,
    update: { position: [number, number, number]; physicsVelocity: [number, number, number] },
  ) => unknown;
  advanceGameplayRules: (seconds: number) => unknown;
  advanceWorldClock?: (hours: number) => unknown;
  setPhysicsActiveChunks?: (keys: readonly string[]) => void;
  queryPickupTargets?: () => readonly AuthorityPickupTarget[];
  pickupItem?: (playerId: string, itemId: string) => Readonly<{ success: boolean }>;
};

export type LogicIntent = Readonly<{
  entityId: string;
  entityReference?: EntityLifetimeReference;
  wish: Readonly<{ x: number; z: number }>;
  jumpRequested: boolean;
  verticalIntent: -1 | 0 | 1;
  expiresAtPhysicsTick: number;
}>;

export type AuthorityMovementSnapshot = Readonly<{ revision: string; flightSpeed: number | null }>;

export type AuthorityBodySnapshot = Readonly<{
  id: string;
  type: AuthorityEntity['type'];
  archetype?: AuthorityEntity['archetype'];
  body: BodyState;
  movement?: AuthorityMovementSnapshot;
  grounded: boolean;
  contacts: readonly Contact[];
}>;

export type BodyRecoveryReason = 'initialization' | 'legacy-restore' | 'external-geometry-change';

export type BodyRecoveryDiagnostic = Readonly<{
  entityId: string;
  reason: BodyRecoveryReason;
  status: 'recovered' | 'blocked' | 'missing';
  distance: number;
  physicsTick: number;
}>;

export type AuthoritySnapshot = Readonly<{
  kind: 'snapshot';
  protocolVersion: 1;
  epoch: string;
  physicsTick: number;
  commitSequence: number;
  worldMutationCount: number;
  acknowledgedInputSequence: number;
  inputResyncRequired: boolean;
  activeTimeMs: number;
  integratedPhysicsTimeMs: number;
  physicsDebtMs: number;
  player: AuthorityBodySnapshot;
  entities: readonly AuthorityBodySnapshot[];
  chunkRevisions: Readonly<Record<string, number>>;
  worldRevision: number;
  worldTime: number;
  paused: boolean;
  diagnostics?: Readonly<{
    recoveryResults: readonly BodyRecoveryDiagnostic[];
    physicsCost?: CostSampleWindow | null;
    fluid?: FluidAuthorityDiagnostics;
    residency?: AuthorityResidencyDiagnostics;
  }>;
}>;

export type AuthorityLaneTotals = Readonly<{
  physicsSteps: number;
  gameplayPeriods: number;
  fluidPeriods: number;
}>;
