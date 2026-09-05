import { describe, expect, it, vi } from 'vitest';
import { BrowserAuthorityClient, type AuthorityWorkerPort } from '../../src/client/browser-authority-client';
import type { AuthorityReady, AuthorityResponse } from '../../src/worker/authority-worker-protocol';

class FakeAuthorityWorker implements AuthorityWorkerPort {
  onmessage: ((event: MessageEvent<AuthorityResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posts: unknown[] = [];
  terminated = false;

  postMessage(message: unknown) {
    this.posts.push(message);
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
  gameplayRevision: 1,
  gameplayTime: 0,
  player: {
    entityId: 'player-1',
    spawnPosition: [0.5, 33, 0.5] as [number, number, number],
    lifecycle: 'alive' as const,
    health: 20,
    maxHealth: 20,
    hunger: 20,
    maxHunger: 20,
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

const ready = (): AuthorityReady => ({
  playerId: 'player-1',
  playerBodyPosition: [0.5, 33, 0.5],
  isNew: true,
  seed: 42,
  seedText: 'worker-client',
  generatorVersion: 3,
  worldTime: 9,
  snapshot: {
    kind: 'snapshot',
    protocolVersion: 1,
    epoch: 'world:1',
    physicsTick: 0,
    commitSequence: 0,
    acknowledgedInputSequence: -1,
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

describe('BrowserAuthorityClient', () => {
  it('等待真实Worker ready并忽略旧epoch快照', async () => {
    const worker = new FakeAuthorityWorker();
    const snapshots = vi.fn();
    const client = new BrowserAuthorityClient(worker, 'world:1', { onSnapshot: snapshots });
    const starting = client.start({
      seedText: 'worker-client',
      openMode: 'continue',
      legacySnapshots: [],
      initialWorldTime: 9,
    });
    expect(worker.posts[0]).toMatchObject({ kind: 'start-authority', epoch: 'world:1' });
    worker.emit({ kind: 'authority-ready', protocolVersion: 1, epoch: 'world:1', ready: ready() });

    await expect(starting).resolves.toMatchObject({ playerId: 'player-1' });
    worker.emit({
      kind: 'authority-snapshot',
      protocolVersion: 1,
      epoch: 'old',
      snapshot: { ...ready().snapshot, epoch: 'old', physicsTick: 9 },
    });
    expect(snapshots).not.toHaveBeenCalled();
  });

  it('异步准备网格后保留本地只读副本并为计算Worker返回独立数组', async () => {
    const worker = new FakeAuthorityWorker();
    const client = new BrowserAuthorityClient(worker, 'world:1');
    const preparing = client.ensureChunkNeighborhood(0, 0, 0);
    const request = worker.posts[0] as { requestId: number };
    const canonical = new Uint16Array(32 ** 3);
    canonical[0] = 3;
    const fluid = new Uint8Array(32 ** 3);
    fluid[0] = 0x88;
    worker.emit({
      kind: 'mesh-prepared',
      protocolVersion: 1,
      epoch: 'world:1',
      requestId: request.requestId,
      payload: {
        key: '0,0,0',
        cx: 0,
        cy: 0,
        cz: 0,
        chunkRevision: 4,
        generatorVersion: 3,
        canonical: canonical.buffer,
        halo: new Uint16Array(34 ** 3).buffer,
        fluid: fluid.buffer,
        fluidHalo: new Uint8Array(34 ** 3).buffer,
        haloRevision: 'halo:4',
      },
    });
    await preparing;

    expect(client.getVoxel(0, 0, 0)).toBe(3);
    expect(client.getFluidCell(0, 0, 0)).toEqual({ level: 8, source: true });
    const first = client.prepareMainSnapshot(0, 0, 0);
    const second = client.prepareMainSnapshot(0, 0, 0);
    expect(first.canonical).not.toBe(second.canonical);
    expect(first.canonical[0]).toBe(3);
  });
});
