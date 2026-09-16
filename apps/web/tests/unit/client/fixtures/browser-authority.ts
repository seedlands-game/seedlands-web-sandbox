import type { AuthorityWorkerPort } from '../../../../src/client/authority/browser-authority-client';
import type {
  AuthorityReady,
  AuthorityResponse,
} from '../../../../../../packages/stdlib/src/server/protocol/authority-worker-protocol';
import { testWorldgenProvider } from './worldgen-provider';

export class FakeAuthorityWorker implements AuthorityWorkerPort {
  onmessage: ((event: MessageEvent<AuthorityResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posts: unknown[] = [];
  transfers: Transferable[][] = [];
  terminated = false;

  postMessage(message: unknown, transfer: Transferable[] = []) {
    this.posts.push(message);
    this.transfers.push(transfer);
  }

  terminate() {
    this.terminated = true;
  }

  emit(message: AuthorityResponse) {
    this.onmessage?.({ data: message } as MessageEvent<AuthorityResponse>);
  }
}

const body = (id = 'player-1') => ({
  id,
  type: 'player' as const,
  body: { position: { x: 0.5, y: 33, z: 0.5 }, velocity: { x: 0, y: 0, z: 0 } },
  grounded: true,
  contacts: [],
});

const gameplay = {
  inventory: {
    version: 1 as const,
    actor: { entityId: 'player-1', epoch: 1, lifetime: 1 },
    revision: 0,
    slots: [],
    hotbarSize: 8,
    cursor: { version: 1 as const, revision: 0, stack: null, origin: null },
  },
  gameplayRevision: 1,
  gameplayTime: 0,
  player: {
    entityId: 'player-1',
    spawnPosition: [0.5, 33, 0.5] as [number, number, number],
    lifecycle: 'alive' as const,
    health: 20,
    maxHealth: 20 as const,
    hunger: 20,
    maxHunger: 20 as const,
    inventory: [],
    selectedSlot: 0,
    hotbarSize: 8 as const,
    attackCooldownSeconds: 0,
    hungerAccumulator: 0,
    healingAccumulator: 0,
    starvationAccumulator: 0,
    breakAction: null,
  },
  entities: [],
  actors: [],
  craftableRecipeIds: [],
  metrics: {
    entityCount: 1,
    worldItemCount: 0,
    creatureCount: 0,
    npcCount: 0,
    nearbyVisitedBucketCount: 0,
    nearbyCandidateCount: 0,
    nearbyReturnedCount: 0,
    inventoryOperationCount: 0,
    gameplayEventCount: 0,
    snapshotBytes: 0,
    retainedActorCount: 0,
    activeActorCount: 0,
    behaviorEvaluationCount: 0,
    navigationPlanCount: 0,
    navigationExpandedNodeCount: 0,
    pathRecomputeCount: 0,
    actionCompletionCount: 0,
    actionFailureCount: 0,
    actionInterruptionCount: 0,
    perceptionLineOfSightCheckCount: 0,
    simulationTime: 0,
  },
};

export const frequencies = { physicsHz: 60, gameplayHz: 20, fluidHz: 30 } as const;

export const ready = (): AuthorityReady => ({
  playerId: 'player-1',
  playerBodyPosition: [0.5, 33, 0.5],
  isNew: true,
  seed: 42,
  seedText: 'worker-client',
  generatorVersion: 3,
  worldgenProvider: testWorldgenProvider,
  worldTime: 9,
  frequencies,
  snapshot: {
    kind: 'snapshot',
    protocolVersion: 1,
    epoch: 'world:1',
    physicsTick: 0,
    commitSequence: 0,
    worldMutationCount: 0,
    acknowledgedInputSequence: -1,
    inputResyncRequired: false,
    activeTimeMs: 0,
    integratedPhysicsTimeMs: 0,
    physicsDebtMs: 0,
    player: body(),
    entities: [body()],
    chunkRevisions: {},
    worldRevision: 0,
    worldTime: 9,
    paused: false,
  },
  gameplay,
});
