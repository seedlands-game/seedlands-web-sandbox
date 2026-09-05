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

describe('BrowserAuthorityClient', () => {
  it('把迟到/非法输入与重同步要求显式反馈预测层', () => {
    const worker = new FakeAuthorityWorker();
    const decisions = vi.fn();
    new BrowserAuthorityClient(worker, 'world:1', { onInputDecision: decisions });
    worker.emit({
      kind: 'input-decision',
      protocolVersion: 1,
      epoch: 'world:1',
      sequence: 4,
      decision: 'late',
      requiresResync: true,
    });
    expect(decisions).toHaveBeenCalledWith({ sequence: 4, decision: 'late', requiresResync: true });
  });

  it('把新世界出生点生成握手交给通用计算池', async () => {
    const worker = new FakeAuthorityWorker();
    const bootstrap = vi.fn(async () => [0.5, 33, 0.5] as [number, number, number]);
    const client = new BrowserAuthorityClient(worker, 'world:1', { onBootstrapGeneration: bootstrap });
    void client.start({ seedText: 'worker-client', openMode: 'continue', legacySnapshots: [], initialWorldTime: 9 });
    worker.emit({
      kind: 'authority-bootstrap-needed',
      protocolVersion: 1,
      epoch: 'world:1',
      requestId: 9,
      seed: 7,
      generatorVersion: 3,
    });
    await vi.waitFor(() => expect(bootstrap).toHaveBeenCalledWith({ seed: 7, generatorVersion: 3 }));
    expect(worker.posts.at(-1)).toMatchObject({
      kind: 'authority-bootstrap-result',
      requestId: 9,
      playerBodyPosition: [0.5, 33, 0.5],
    });
  });

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

  it('异步准备Worker输入，并只在权威接纳计算结果后开放本地只读副本', async () => {
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
        fluid: fluid.buffer,
        overlays: [],
      },
    });
    await preparing;

    expect(client.getVoxel(0, 0, 0)).toBe(0);
    const first = client.prepareWorkerInput(0, 0, 0);
    const second = client.prepareWorkerInput(0, 0, 0);
    expect(first.canonical).not.toBe(second.canonical);
    expect(first.canonical?.[0]).toBe(3);

    const workerCanonical = new Uint16Array(32 ** 3);
    workerCanonical[0] = 4;
    const accepting = client.acceptWorkerCanonical(
      {
        chunkKey: '0,0,0',
        cx: 0,
        cy: 0,
        cz: 0,
        chunkRevision: 4,
        generatorVersion: 3,
      },
      { canonical: workerCanonical.buffer, generatorVersion: 3 },
    );
    const acceptRequest = worker.posts.at(-1) as { kind: string; requestId: number };
    expect(acceptRequest.kind).toBe('accept-generated-chunk');
    worker.emit({
      kind: 'authority-response',
      protocolVersion: 1,
      epoch: 'world:1',
      requestId: acceptRequest.requestId,
      ok: true,
      result: { accepted: true },
    });
    await expect(accepting).resolves.toBe(true);
    expect(client.getVoxel(0, 0, 0)).toBe(4);
  });

  it('区分世界写入次数、全局提交序号与物理tick', async () => {
    const worker = new FakeAuthorityWorker();
    const client = new BrowserAuthorityClient(worker, 'world:1');
    const starting = client.start({
      seedText: 'worker-client',
      openMode: 'continue',
      legacySnapshots: [],
      initialWorldTime: 9,
    });
    const base = ready();
    const current = {
      ...base,
      snapshot: { ...base.snapshot, physicsTick: 60, commitSequence: 8, worldMutationCount: 2 },
    };
    worker.emit({ kind: 'authority-ready', protocolVersion: 1, epoch: 'world:1', ready: current });
    await starting;

    expect(client.physicsTick).toBe(60);
    expect(client.commitSequence).toBe(8);
    expect(client.mutationCount).toBe(2);
  });

  it('为不同生产者事务携带独立幂等流序号', async () => {
    const worker = new FakeAuthorityWorker();
    const client = new BrowserAuthorityClient(worker, 'world:1');
    const editing = client.editWorld('player-1', [{ x: 0, y: 0, z: 0, value: 1 }]);
    const request = worker.posts.at(-1) as { requestId: number; transaction: unknown };
    expect(request.transaction).toEqual({ issuer: 'browser:world:1', stream: 'world-edit', sequence: 0 });
    worker.emit({
      kind: 'authority-response',
      protocolVersion: 1,
      epoch: 'world:1',
      requestId: request.requestId,
      ok: true,
      result: { committed: false },
      commitSequence: 4,
    });
    await expect(editing).resolves.toEqual({ committed: false });
  });

  it('以幂等事务设置Authority世界时钟速率', async () => {
    const worker = new FakeAuthorityWorker();
    const client = new BrowserAuthorityClient(worker, 'world:1');
    const setting = client.setWorldClockRate(0);
    const request = worker.posts.at(-1) as {
      kind: string;
      requestId: number;
      rate: number;
      transaction: unknown;
    };

    expect(request).toMatchObject({
      kind: 'set-world-clock-rate',
      rate: 0,
      transaction: { issuer: 'browser:world:1', stream: 'world-clock-rate', sequence: 0 },
    });
    worker.emit({
      kind: 'authority-response',
      protocolVersion: 1,
      epoch: 'world:1',
      requestId: request.requestId,
      ok: true,
      result: { rate: 0 },
    });
    await expect(setting).resolves.toEqual({ rate: 0 });
  });
});
