import type { BodyState, Contact } from '../../physics';

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

export type AuthorityServerPort = {
  readonly worldRevision: number;
  readonly mutationCount: number;
  readonly worldTime: number;
  getEntity: (id: string) => AuthorityEntity | null;
  queryEntities: () => AuthorityEntity[];
  updateEntity: (
    id: string,
    update: { position: [number, number, number]; physicsVelocity: [number, number, number] },
  ) => unknown;
  advanceGameplayRules: (seconds: number) => unknown;
  advanceWorldClock?: (hours: number) => unknown;
  queryPickupTargets?: () => readonly AuthorityPickupTarget[];
  pickupItem?: (playerId: string, itemId: string) => Readonly<{ success: boolean }>;
};

export type LogicIntent = Readonly<{
  entityId: string;
  wish: Readonly<{ x: number; z: number }>;
  jumpRequested: boolean;
  verticalIntent: -1 | 0 | 1;
  expiresAtPhysicsTick: number;
}>;

export type AuthorityBodySnapshot = Readonly<{
  id: string;
  type: AuthorityEntity['type'];
  archetype?: AuthorityEntity['archetype'];
  body: BodyState;
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
  diagnostics?: Readonly<{ recoveryResults: readonly BodyRecoveryDiagnostic[] }>;
}>;

export type AuthorityLaneTotals = Readonly<{
  physicsSteps: number;
  gameplayPeriods: number;
  fluidPeriods: number;
}>;
