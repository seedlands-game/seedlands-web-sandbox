import { describe, expect, it, vi } from 'vitest';
import { observeAuthorityColumnSource } from '../../../src/worker/authority-column-source';
import { browserWorldOwnerPolicy } from '../../../src/worker/authority-worker-world-policy';
import { AuthorityRuntime } from '../../../../../packages/stdlib/src/server/authority/authority-runtime';
import { AuthorityWorldHarness } from '../../../../../packages/stdlib/src/server/harness/authority-world-harness';
import { WorldResourceAuthorizer } from '../../../../../packages/stdlib/src/server/harness/world-authorization';
import { MemoryGamePersistence } from '../../../../../packages/stdlib/src/server/persistence/memory-game-persistence';
import { testCorePlatform } from '../../../../../packages/stdlib/tests/support/core-platform';
import { testWorldgenExecutableProvider } from '../../../../../packages/stdlib/tests/support/worldgen';

const make = async () => {
  const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
  const worldgenProvider = { ...testWorldgenExecutableProvider, generatedEmptyAboveY: () => 51 };
  const runtime = await AuthorityRuntime.create({
    platform: testCorePlatform,
    epoch: 'world:1',
    seedText: 'sky-renderer-source',
    persistence,
    worldgenProvider,
    initialWorldTime: 9,
    startTimeMs: 0,
    initialPlayerBodyPosition: [0.5, 33, 0.5],
  });
  let epoch = 'world:1';
  const authorization = new WorldResourceAuthorizer(browserWorldOwnerPolicy('owner', runtime.playerId));
  const harness = new AuthorityWorldHarness({
    platform: testCorePlatform,
    principalId: 'owner',
    authorization,
    owner: () => ({ runtime, epoch, worldId: 'world' }),
    prepareChunk: async () => undefined,
    advance: async (ms) => runtime.advancePausedSession(ms),
    restore: async () => undefined,
  });
  return {
    persistence,
    runtime,
    harness,
    owner: () => ({ server: runtime.server, epoch, worldId: 'world' }),
    replaceEpoch: () => {
      epoch = 'world:2';
    },
  };
};

describe('normal renderer column observation on the existing Authority host queue', () => {
  it('World chunk authorization stays denied while the renderer observes its own bounded metadata', async () => {
    const { runtime, harness, owner } = await make();
    expect(await harness.inspect({ kind: 'column-source', column: [9, 9] })).toMatchObject({
      ok: false,
      error: { kind: 'permission' },
    });
    const before = runtime.server.readCollisionBaseline('9,0,9', 0);
    expect(await observeAuthorityColumnSource(harness, owner, 9, 9, 'world:1')).toMatchObject({
      status: 'complete',
      entries: [],
      generatedEmptyAboveY: 51,
    });
    expect(runtime.server.readCollisionBaseline('9,0,9', 0)).toEqual(before);
  });
  it.each([undefined, 'world:old'])(
    'rejects missing/stale runtime envelope %s before directory access',
    async (requestedEpoch) => {
      const { harness, persistence, owner } = await make();
      const inspect = vi.spyOn(persistence, 'inspectColumnDirectory');
      await expect(observeAuthorityColumnSource(harness, owner, 0, 0, requestedEpoch)).rejects.toThrow(
        'WORLD_EPOCH_STALE',
      );
      expect(inspect).not.toHaveBeenCalled();
    },
  );
  it('pending I/O does not block real host work and cannot publish across outer restore', async () => {
    const { harness, persistence, owner, replaceEpoch } = await make();
    let release!: () => void;
    let enter!: () => void;
    const started = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = persistence.inspectColumnDirectory.bind(persistence);
    vi.spyOn(persistence, 'inspectColumnDirectory').mockImplementation(async (cx, cz) => {
      enter();
      await wait;
      return original(cx, cz);
    });
    const pending = observeAuthorityColumnSource(harness, owner, 0, 0, 'world:1');
    await started;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        harness.hostOperation(replaceEpoch),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error('host blocked')), 1000);
        }),
      ]);
    } finally {
      clearTimeout(timer);
      release();
    }
    expect(await pending).toEqual({ status: 'unknown', reason: 'superseded' });
  });
});
