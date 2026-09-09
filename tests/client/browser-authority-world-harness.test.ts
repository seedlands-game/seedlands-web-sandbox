import { describe, expect, it, vi } from 'vitest';
import {
  BrowserAuthorityClient,
  type AuthorityWorkerPort,
} from '../../apps/web/src/client/authority/browser-authority-client';
import type { AuthorityReady, AuthorityResponse } from '../../packages/game-core/src/compute/authority-worker-protocol';

class FakeAuthorityWorker implements AuthorityWorkerPort {
  onmessage: ((event: MessageEvent<AuthorityResponse>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posts: unknown[] = [];
  postMessage(message: unknown) {
    this.posts.push(message);
  }
  terminate() {}
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

const ready = (): AuthorityReady => ({
  playerId: 'player-1',
  playerBodyPosition: [0.5, 33, 0.5],
  isNew: true,
  seed: 42,
  seedText: 'worker-client',
  generatorVersion: 3,
  worldTime: 9,
  frequencies: { physicsHz: 60, gameplayHz: 20, fluidHz: 30 },
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
  gameplay: {
    gameplayRevision: 1,
    gameplayTime: 0,
    player: {
      entityId: 'player-1',
      spawnPosition: [0.5, 33, 0.5],
      lifecycle: 'alive',
      health: 20,
      maxHealth: 20,
      hunger: 20,
      maxHunger: 20,
      inventory: [],
      selectedSlot: 0,
      hotbarSize: 8,
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
  },
});

describe('Browser Authority world harness', () => {
  it('validates through Authority before a canonical-free mesh then refreshes the explicit baseline', async () => {
    const worker = new FakeAuthorityWorker();
    const client = new BrowserAuthorityClient(worker, 'world:1');
    const starting = client.start({
      seedText: 'target-seed',
      openMode: 'continue',
      legacySnapshots: [],
      initialWorldTime: 9,
      frequencies: { physicsHz: 60, gameplayHz: 20, fluidHz: 30 },
    });
    worker.emit({ kind: 'authority-ready', protocolVersion: 1, epoch: 'world:1', ready: ready() });
    await starting;

    const preparing = client.world.prepare({ kind: 'chunk', chunk: [6, 0, 0] });
    expect(worker.posts.at(-1)).toMatchObject({ kind: 'world-harness-rpc', method: 'prepare' });
    const harnessRequest = worker.posts.at(-1) as { requestId: number };
    worker.emit({
      kind: 'world-harness-response',
      protocolVersion: 1,
      epoch: 'world:1',
      requestId: harnessRequest.requestId,
      result: {
        ok: true,
        data: { prepared: ['6,0,0'] },
        frontier: {
          worldId: 'seedlands:g3:worker-client',
          epoch: 'world:1:world:0',
          worldRevision: 0,
          commitSequence: 0,
          physicsTick: 0,
          fluidWorkSequence: 0,
          logicObservationSequence: 0,
        },
      },
    });
    await vi.waitFor(() => expect(worker.posts.at(-1)).toMatchObject({ kind: 'prepare-mesh', cx: 6, cy: 0, cz: 0 }));
    const meshRequest = worker.posts.at(-1) as { requestId: number };
    worker.emit({
      kind: 'mesh-prepared',
      protocolVersion: 1,
      epoch: 'world:1',
      requestId: meshRequest.requestId,
      payload: {
        key: '6,0,0',
        cx: 6,
        cy: 0,
        cz: 0,
        chunkRevision: 0,
        generatorVersion: 3,
        overlays: [],
      },
    });
    await vi.waitFor(() =>
      expect(worker.posts.at(-1)).toMatchObject({
        kind: 'request-collision-baseline',
        key: '6,0,0',
        minimumRevision: 0,
      }),
    );
    const baselineRequest = worker.posts.at(-1) as { requestId: number };
    const canonical = new Uint16Array(32 ** 3);
    canonical[0] = 6;
    worker.emit({
      kind: 'authority-response',
      protocolVersion: 1,
      epoch: 'world:1',
      requestId: baselineRequest.requestId,
      ok: true,
      result: {
        status: 'available',
        key: '6,0,0',
        chunkRevision: 0,
        canonical: canonical.buffer,
        fluid: new Uint8Array(32 ** 3).buffer,
      },
    });

    await expect(preparing).resolves.toMatchObject({ ok: true });
    expect(client.getVoxel(6 * 32, 0, 0)).toBe(6);
  });

  it('does not send product preparation I/O for a malformed request', async () => {
    const worker = new FakeAuthorityWorker();
    const client = new BrowserAuthorityClient(worker, 'world:1');
    const preparing = client.world.prepare(null as never);
    const request = worker.posts.at(-1) as { requestId: number };
    expect(worker.posts).toHaveLength(1);
    expect(request).toMatchObject({ kind: 'world-harness-rpc', method: 'prepare' });
    worker.emit({
      kind: 'world-harness-response',
      protocolVersion: 1,
      epoch: 'world:1',
      requestId: request.requestId,
      result: {
        ok: false,
        error: { code: 'WORLD_REQUEST_INVALID', message: 'World prepare request is invalid.', kind: 'validation' },
      },
    });
    await expect(preparing).resolves.toMatchObject({ ok: false, error: { code: 'WORLD_REQUEST_INVALID' } });
    expect(worker.posts).toHaveLength(1);
  });

  it('通过稳定 world 代理把开发请求发送到真实 Authority Worker 协议', async () => {
    const worker = new FakeAuthorityWorker();
    const client = new BrowserAuthorityClient(worker, 'world:1');
    const identity = client.world.identity();
    const request = worker.posts.at(-1) as { requestId: number; method: string };
    expect(request).toMatchObject({ kind: 'world-harness-rpc', method: 'identity' });
    worker.emit({
      kind: 'world-harness-response',
      protocolVersion: 1,
      epoch: 'world:1',
      requestId: request.requestId,
      result: {
        ok: true,
        data: { runtime: 'authority' },
        frontier: {
          worldId: 'seedlands:g3:worker-client',
          epoch: 'world:1:world:0',
          worldRevision: 0,
          commitSequence: 0,
          physicsTick: 0,
          fluidWorkSequence: 0,
          logicObservationSequence: 0,
        },
      },
    });
    await expect(identity).resolves.toMatchObject({ ok: true, data: { runtime: 'authority' } });
    expect(client.world).toBe(client.world);
  });

  it('恢复后切换内部runtime epoch、清除存储测量并重写玩家输入epoch', async () => {
    const worker = new FakeAuthorityWorker();
    const changed = vi.fn();
    const client = new BrowserAuthorityClient(worker, 'world:1', { onWorldEpochChanged: changed });
    const restoring = client.world.checkpoint({ kind: 'restore', snapshot: {} });
    const request = worker.posts.at(-1) as { requestId: number };
    const initialReady = ready();
    const restoredReady = {
      ...initialReady,
      snapshot: { ...initialReady.snapshot, epoch: 'world:1:runtime:1', paused: true },
    };
    worker.emit({
      kind: 'world-harness-response',
      protocolVersion: 1,
      epoch: 'world:1',
      requestId: request.requestId,
      result: {
        ok: true,
        data: { restored: true, byteLength: 1 },
        frontier: {
          worldId: 'seedlands:g3:worker-client',
          epoch: 'world:1:world:1',
          worldRevision: 0,
          commitSequence: 1,
          physicsTick: 0,
          fluidWorkSequence: 0,
          logicObservationSequence: 0,
        },
      },
      ready: restoredReady,
      runtimeEpoch: 'world:1:runtime:1',
    });
    await restoring;
    expect(changed).toHaveBeenCalledWith('world:1:runtime:1', restoredReady);
    client.sendInput({
      kind: 'input',
      protocolVersion: 1,
      epoch: 'world:1',
      stream: 'player-input',
      sequence: 1,
      targetPhysicsTick: 1,
      issuedAtMs: 1,
      state: { moveX: 0, moveZ: 0, verticalIntent: 0, jumpHeld: false },
      edges: { jumpPressed: false },
    });
    expect(worker.posts.at(-1)).toMatchObject({ kind: 'input', epoch: 'world:1', runtimeEpoch: 'world:1:runtime:1' });
    expect(client.storageBytesMeasurement).toBeNull();
  });
});
