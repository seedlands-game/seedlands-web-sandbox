import { describe, expect, it, vi } from 'vitest';
import {
  observeAuthoritySkySource,
  handleAuthorityRendererSource,
} from '../../../src/worker/authority-renderer-source';
import { browserWorldOwnerPolicy } from '../../../src/worker/authority-worker-world-policy';
import { AuthorityRuntime } from '@seedlands/stdlib/server/authority/authority-runtime';
import { AuthorityWorldHarness } from '@seedlands/stdlib/server/harness/authority-world-harness';
import { WorldResourceAuthorizer } from '@seedlands/stdlib/server/harness/world-authorization';
import { MemoryGamePersistence } from '@seedlands/stdlib/server/persistence/memory-game-persistence';
import type { ChunkSnapshot } from '@seedlands/stdlib/server/persistence/chunk-persistence';
import { CHUNK_SIZE, voxelIndex } from '@seedlands/stdlib/world/voxel';
import { classicContent } from '../../fixtures/classic/content';
import { requestBrowserSkyChunk } from '../../../src/client/authority/browser-authority-sky-chunk';
import { prepareSkyColumnReader } from '../../../src/app/scene/sky-column-reader';
import { readSkyColumnProofByTask } from '../../../src/app/scene/sky-column-source';
import { testCorePlatform } from '../../../../../packages/stdlib/tests/support/core-platform';
import { testWorldgenExecutableProvider } from '../../../../../packages/stdlib/tests/support/worldgen';

const KEY = '9,3,9';
const make = async () => {
  const memory = new MemoryGamePersistence({ clone: testCorePlatform.clone });
  const worldgenProvider = { ...testWorldgenExecutableProvider, generatedEmptyAboveY: () => 51 };
  const runtime = await AuthorityRuntime.create({
    platform: testCorePlatform,
    epoch: 'world:1',
    seedText: 'durable-sky-source',
    persistence: memory,
    worldgenProvider,
    initialWorldTime: 9,
    startTimeMs: 0,
    initialPlayerBodyPosition: [0.5, 33, 0.5],
  });
  const stored: ChunkSnapshot = {
    key: KEY,
    cx: 9,
    cy: 3,
    cz: 9,
    revision: 7,
    seedText: 'durable-sky-source',
    generatorVersion: runtime.server.generatorVersion,
    voxels: new Uint16Array(CHUNK_SIZE ** 3),
    fluidVersion: 1,
    fluid: new Uint8Array(CHUNK_SIZE ** 3),
  };
  stored.voxels[19] = 3;
  stored.voxels[voxelIndex(0, 2, 0)] = 3;
  stored.fluid![19] = 4;
  memory.saveSnapshots([stored]);
  const persistence = {
    worldId: 'world',
    seedText: stored.seedText,
    generatorVersion: stored.generatorVersion,
    sourceReadFence: vi.fn().mockReturnValue(Symbol()),
    readStoredSkySnapshot: vi.fn(async (): Promise<ChunkSnapshot | null> => stored),
  };
  let epoch = 'world:1';
  const harness = new AuthorityWorldHarness({
    platform: testCorePlatform,
    principalId: 'owner',
    authorization: new WorldResourceAuthorizer(browserWorldOwnerPolicy('owner', runtime.playerId)),
    owner: () => ({ runtime, epoch, worldId: persistence.worldId }),
    prepareChunk: async () => undefined,
    advance: async (ms) => runtime.advancePausedSession(ms),
    restore: async () => undefined,
  });
  return {
    runtime,
    persistence,
    stored,
    harness,
    owner: () => ({ runtime, persistence, epoch }),
    replaceEpoch: () => {
      epoch = 'world:2';
    },
  };
};

describe('durable Sky source on the current Authority renderer frontier', () => {
  it('uses the saved nonresident roof in the real client column proof without creating residency', async () => {
    const { runtime, harness, owner } = await make();
    const source = await runtime.server.inspectColumnSource(9, 9);
    expect(source.status).toBe('complete');
    const readChunk = (cx: number, cy: number, cz: number, revision: number) =>
      requestBrowserSkyChunk(
        (message) =>
          message.kind === 'request-sky-source'
            ? observeAuthoritySkySource(
                harness,
                owner,
                message.key as string,
                message.minimumRevision as number,
                'world:1',
              )
            : Promise.resolve(runtime.readCollisionBaseline(message.key as string, message.minimumRevision as number)),
        () => 'world:1',
        cx,
        cy,
        cz,
        revision,
      );
    const reader = await prepareSkyColumnReader(
      source,
      [9, 1, 9],
      {
        getChunkRevision: (cx, cy, cz) => (cx === 9 && cy === 1 && cz === 9 ? 0 : null),
        getVoxel: () => 0,
        voxelSemantics: classicContent.voxelSemantics,
      },
      readChunk,
      () => true,
    );
    expect(reader).not.toBeNull();
    if (!reader) throw new Error('Durable roof did not produce a column reader.');
    const proof = await readSkyColumnProofByTask(source, [9, 1, 9], reader, {
      isCurrent: () => true,
      yieldTask: async () => undefined,
    });
    expect(proof?.columns[0]?.loaded[98 - 32]).toBe(1);
    expect(proof?.columns[0]?.obstruction[98 - 32]).toBe(255);
    expect(runtime.readCollisionBaseline(KEY, 0).status).toBe('unavailable');
  });
  it('transfers an exact durable copy while its collision baseline remains unavailable', async () => {
    const { runtime, persistence, stored, harness, owner } = await make();
    const before = runtime.readCollisionBaseline(KEY, 0);
    expect(before.status).toBe('unavailable');
    const result = await observeAuthoritySkySource(harness, owner, KEY, 7, 'world:1');
    expect(result.status).toBe('available');
    if (result.status !== 'available') throw new Error('Exact source was unavailable.');
    expect(new Uint16Array(result.canonical)[19]).toBe(3);
    expect(new Uint8Array(result.fluid)[19]).toBe(4);
    structuredClone(result, { transfer: [result.canonical, result.fluid] });
    expect(stored.voxels.byteLength).toBe(65536);
    expect(stored.fluid!.byteLength).toBe(32768);
    expect(persistence.readStoredSkySnapshot).toHaveBeenCalledWith(9, 3, 9, 7);
    expect(runtime.readCollisionBaseline(KEY, 0)).toEqual(before);
  });
  it.each([undefined, 'world:old'])('rejects stale envelope %s before persistence access', async (epoch) => {
    const { persistence, harness, owner } = await make();
    await expect(observeAuthoritySkySource(harness, owner, KEY, 7, epoch)).rejects.toThrow('WORLD_EPOCH_STALE');
    expect(persistence.readStoredSkySnapshot).not.toHaveBeenCalled();
  });
  it('uses the current resident version without reading an older durable record', async () => {
    const { runtime, persistence, harness, owner } = await make();
    const key = '0,0,0';
    runtime.server.getChunk(0, 0, 0);
    const resident = runtime.readCollisionBaseline(key, 0);
    expect(resident.status).toBe('available');
    if (resident.status !== 'available') throw new Error('Fixture resident was unavailable.');
    expect(await observeAuthoritySkySource(harness, owner, key, resident.chunkRevision, 'world:1')).toMatchObject({
      status: 'available',
      key,
      chunkRevision: resident.chunkRevision,
    });
    expect(await observeAuthoritySkySource(harness, owner, key, resident.chunkRevision + 1, 'world:1')).toEqual({
      status: 'unavailable',
      key,
    });
    expect(persistence.readStoredSkySnapshot).not.toHaveBeenCalled();
  });
  it('discards a copy if a save fence changes while the durable read is pending', async () => {
    const { persistence, stored, harness, owner } = await make();
    let enter!: () => void, release!: (value: ChunkSnapshot) => void;
    const started = new Promise<void>((resolve) => {
      enter = resolve;
    });
    persistence.readStoredSkySnapshot.mockImplementation(() => {
      enter();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const pending = observeAuthoritySkySource(harness, owner, KEY, 7, 'world:1');
    await started;
    persistence.sourceReadFence.mockReturnValue(Symbol());
    release(stored);
    expect(await pending).toEqual({ status: 'unavailable', key: KEY });
  });
  it.each(['key', 'revision', 'shape', 'seed', 'generator', 'fluid'] as const)(
    'does not publish a mismatched durable %s',
    async (failure) => {
      const { stored, harness, owner } = await make();
      if (failure === 'key') stored.key = '9,4,9';
      if (failure === 'revision') stored.revision = 8;
      if (failure === 'shape') stored.voxels = new Uint16Array(1);
      if (failure === 'seed') stored.seedText = 'other-world';
      if (failure === 'generator') stored.generatorVersion += 1;
      if (failure === 'fluid') stored.fluid = new Uint8Array(1);
      expect(await observeAuthoritySkySource(harness, owner, KEY, 7, 'world:1')).toEqual({
        status: 'unavailable',
        key: KEY,
      });
    },
  );
  it('accepts and consumes real input while durable I/O is pending, then rejects the old epoch', async () => {
    const { runtime, persistence, stored, harness, owner, replaceEpoch } = await make();
    let enter!: () => void, release!: (value: ChunkSnapshot | null) => void;
    const started = new Promise<void>((resolve) => {
      enter = resolve;
    });
    persistence.readStoredSkySnapshot.mockImplementation(() => {
      enter();
      return new Promise((resolve) => {
        release = resolve;
      });
    });
    const pending = observeAuthoritySkySource(harness, owner, KEY, 7, 'world:1');
    await started;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const observed = await Promise.race([
        harness.hostOperation(() => {
          runtime.resume(0);
          const before = runtime.wake(0);
          const decision = runtime.receiveInput({
            kind: 'input',
            protocolVersion: 1,
            epoch: 'world:1',
            stream: 'player-input',
            sequence: 0,
            targetPhysicsTick: before.physicsTick + 2,
            issuedAtMs: 0,
            state: { moveX: 1, moveZ: 0, jumpHeld: false, verticalIntent: 0 },
            edges: { jumpPressed: false },
          });
          const after = runtime.wake(100);
          replaceEpoch();
          return { decision, before, after };
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('Host input blocked')), 1000);
        }),
      ]);
      expect(observed.decision).toBe('accepted');
      expect(observed.after.physicsTick).toBeGreaterThan(observed.before.physicsTick);
      expect(observed.after.acknowledgedInputSequence).toBe(0);
    } finally {
      clearTimeout(timer);
      release(stored);
    }
    expect(await pending).toEqual({ status: 'unavailable', key: KEY });
  });
  it('publishes the new response with only its owned transfer buffers', async () => {
    const { harness, owner } = await make();
    const post = vi.fn();
    await handleAuthorityRendererSource(
      {
        kind: 'request-sky-source',
        protocolVersion: 1,
        epoch: 'session',
        runtimeEpoch: 'world:1',
        requestId: 4,
        key: KEY,
        minimumRevision: 7,
      },
      harness,
      owner,
      'session',
      post,
    );
    const [response, transfers] = post.mock.calls[0]!;
    expect(response).toMatchObject({
      epoch: 'session',
      runtimeEpoch: 'world:1',
      requestId: 4,
      ok: true,
      result: { status: 'available', key: KEY, chunkRevision: 7 },
    });
    expect(transfers).toEqual([response.result.canonical, response.result.fluid]);
  });
});
