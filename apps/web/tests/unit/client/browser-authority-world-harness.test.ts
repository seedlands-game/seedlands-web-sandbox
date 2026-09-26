import { describe, expect, it, vi } from 'vitest';
import {
  BrowserAuthorityClient,
  type AuthorityWorkerPort,
} from '../../../src/client/authority/browser-authority-client';
import type {
  AuthorityReady,
  AuthorityResponse,
} from '../../../../../packages/stdlib/src/server/protocol/authority-worker-protocol';
import type { MediaPlaybackFactV1, MediaPlaybackProjectionV1 } from '@seedlands/stdlib/mod-api';

const mediaDevice = { kind: 'voxel' as const, position: [1, 2, 3] as const, definitionId: 'sample:device' };
const mediaResource = { packId: 'sample:pack', path: 'assets/audio/track.mp3' } as const;
const mediaProjection = (revision: number): MediaPlaybackProjectionV1 => ({
  version: 1,
  device: mediaDevice,
  revision,
  slot: { itemId: 'sample:disc', trackId: 'sample:track' },
  resource: mediaResource,
  playing: false,
  resumePending: true,
});
const mediaFact = (revision: number): MediaPlaybackFactV1 => ({
  version: 1,
  kind: 'activate',
  device: mediaDevice,
  revision,
  previousTrackId: 'sample:track',
  trackId: 'sample:track',
  resource: mediaResource,
  playing: true,
  resumePending: false,
});

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
    inventory: {
      version: 1 as const,
      actor: { entityId: 'player-1', epoch: 1, lifetime: 1 },
      revision: 0,
      slots: [],
      hotbarSize: 8,
      armor: { helmet: null, chestplate: null, leggings: null, boots: null },
      cursor: { version: 1 as const, revision: 0, stack: null, origin: null },
    },
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

  it('atomically replaces media epoch on restore, accepts new-world facts and drops old-world facts', async () => {
    const worker = new FakeAuthorityWorker();
    const order: string[] = [];
    const projections = vi.fn(() => order.push('projection'));
    const facts = vi.fn();
    const client = new BrowserAuthorityClient(worker, 'session:1', {
      onMediaProjection: projections,
      onMediaFacts: facts,
      onWorldEpochChanged: () => order.push('epoch'),
    });
    const restoring = client.world.checkpoint({ kind: 'restore', snapshot: {} });
    const request = worker.posts.at(-1) as { requestId: number };
    const restoredBase = ready();
    const restoredReady = {
      ...restoredBase,
      snapshot: { ...restoredBase.snapshot, epoch: 'runtime:2' },
      gameplay: {
        ...restoredBase.gameplay,
        media: [{ ...mediaProjection(2), playing: true, resumePending: false }],
      },
    };
    worker.emit({
      kind: 'world-harness-response',
      protocolVersion: 1,
      epoch: 'session:1',
      requestId: request.requestId,
      result: { ok: true, data: { restored: true }, frontier: { worldId: 'world', epoch: 'runtime:2' } },
      ready: restoredReady,
      runtimeEpoch: 'runtime:2',
    } as AuthorityResponse);
    await restoring;
    expect(order).toEqual(['epoch', 'projection']);

    worker.emit({
      kind: 'authority-media-facts',
      protocolVersion: 1,
      epoch: 'session:1',
      batch: { version: 1, worldEpoch: 'runtime:1', worldRevision: 0, gameplayRevision: 2, facts: [mediaFact(3)] },
    });
    worker.emit({
      kind: 'authority-media-facts',
      protocolVersion: 1,
      epoch: 'session:1',
      batch: { version: 1, worldEpoch: 'runtime:2', worldRevision: 0, gameplayRevision: 2, facts: [mediaFact(2)] },
    });
    expect(facts).toHaveBeenCalledOnce();
  });

  it('preserves the old media world when a restored projection batch is malformed', async () => {
    const worker = new FakeAuthorityWorker();
    const projections = vi.fn();
    const facts = vi.fn();
    const changed = vi.fn();
    const client = new BrowserAuthorityClient(worker, 'session:1', {
      onMediaProjection: projections,
      onMediaFacts: facts,
      onWorldEpochChanged: changed,
    });
    const initialBase = ready();
    const initialReady = {
      ...initialBase,
      snapshot: { ...initialBase.snapshot, epoch: 'session:1' },
      gameplay: {
        ...initialBase.gameplay,
        media: [{ ...mediaProjection(1), playing: true, resumePending: false }],
      },
    };
    const starting = client.start({
      seedText: 'worker-client',
      openMode: 'continue',
      legacySnapshots: [],
      initialWorldTime: 9,
      frequencies: initialReady.frequencies,
    });
    worker.emit({ kind: 'authority-ready', protocolVersion: 1, epoch: 'session:1', ready: initialReady });
    await starting;
    worker.emit({
      kind: 'authority-media-facts',
      protocolVersion: 1,
      epoch: 'session:1',
      batch: { version: 1, worldEpoch: 'session:1', worldRevision: 0, gameplayRevision: 1, facts: [mediaFact(1)] },
    });
    projections.mockClear();
    facts.mockClear();

    const restoring = client.world.checkpoint({ kind: 'restore', snapshot: {} });
    const request = worker.posts.at(-1) as { requestId: number };
    const restoredBase = ready();
    const restoredReady = {
      ...restoredBase,
      snapshot: { ...restoredBase.snapshot, epoch: 'runtime:2' },
      gameplay: { ...restoredBase.gameplay, media: [{ ...mediaProjection(2), resource: null }] },
    };
    worker.emit({
      kind: 'world-harness-response',
      protocolVersion: 1,
      epoch: 'session:1',
      requestId: request.requestId,
      result: { ok: true, data: { restored: true }, frontier: { worldId: 'world', epoch: 'runtime:2' } },
      ready: restoredReady,
      runtimeEpoch: 'runtime:2',
    } as AuthorityResponse);

    await expect(restoring).rejects.toThrow(/slot and resource/i);
    expect(client.runtimeEpoch).toBe('session:1');
    expect(projections).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();

    worker.emit({
      kind: 'authority-media-facts',
      protocolVersion: 1,
      epoch: 'session:1',
      batch: { version: 1, worldEpoch: 'session:1', worldRevision: 0, gameplayRevision: 1, facts: [mediaFact(1)] },
    });
    worker.emit({
      kind: 'authority-snapshot',
      protocolVersion: 1,
      epoch: 'session:1',
      snapshot: { ...initialReady.snapshot, physicsTick: 1 },
      gameplay: {
        ...initialReady.gameplay,
        gameplayRevision: 2,
        media: [{ ...mediaProjection(2), playing: true, resumePending: false }],
      },
    });
    worker.emit({
      kind: 'authority-media-facts',
      protocolVersion: 1,
      epoch: 'session:1',
      batch: { version: 1, worldEpoch: 'session:1', worldRevision: 0, gameplayRevision: 2, facts: [mediaFact(2)] },
    });
    expect(facts).toHaveBeenCalledOnce();
  });

  it('rejects a restored runtime epoch mismatch before replacing media state', async () => {
    const worker = new FakeAuthorityWorker();
    const projections = vi.fn();
    const changed = vi.fn();
    const client = new BrowserAuthorityClient(worker, 'session:1', {
      onMediaProjection: projections,
      onWorldEpochChanged: changed,
    });
    const restoring = client.world.checkpoint({ kind: 'restore', snapshot: {} });
    const request = worker.posts.at(-1) as { requestId: number };
    const restoredBase = ready();
    const restoredReady = {
      ...restoredBase,
      snapshot: { ...restoredBase.snapshot, epoch: 'runtime:2' },
      gameplay: { ...restoredBase.gameplay, media: [mediaProjection(2)] },
    };
    worker.emit({
      kind: 'world-harness-response',
      protocolVersion: 1,
      epoch: 'session:1',
      requestId: request.requestId,
      result: { ok: true, data: { restored: true }, frontier: { worldId: 'world', epoch: 'runtime:2' } },
      ready: restoredReady,
      runtimeEpoch: 'runtime:other',
    } as AuthorityResponse);

    await expect(restoring).rejects.toThrow(/runtime epoch/i);
    expect(client.runtimeEpoch).toBe('session:1');
    expect(projections).not.toHaveBeenCalled();
    expect(changed).not.toHaveBeenCalled();
  });
});
