import { describe, expect, it, vi } from 'vitest';
import { AuthorityRuntime } from '../../src/server/authority/authority-runtime';
import { AuthorityWorldHarness, type AuthorityWorldOwner } from '../../src/server/harness/authority-world-harness';
import { WorldResourceAuthorizer } from '../../src/server/harness/world-authorization';
import { MemoryGamePersistence } from '../../src/server/persistence/memory-game-persistence';
import { testCorePlatform } from '../support/core-platform';
import { testWorldgenExecutableProvider } from '../support/worldgen';

const make = async (scope: 'any' | 'self' = 'any') => {
  const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
  const worldgenProvider = { ...testWorldgenExecutableProvider, generatedEmptyAboveY: () => 51 };
  const runtime = await AuthorityRuntime.create({
    platform: testCorePlatform,
    epoch: 'column-world:1',
    seedText: 'column-rpc',
    persistence,
    worldgenProvider,
    initialWorldTime: 9,
    startTimeMs: 0,
    initialPlayerBodyPosition: [0.5, 33, 0.5],
  });
  let owner: AuthorityWorldOwner = { runtime, worldId: 'column-world', epoch: 'column-world:1' };
  const authorization = new WorldResourceAuthorizer({
    principals: [{ id: 'reader', boundEntityId: runtime.playerId }],
    rules: [{ effect: 'allow', resources: ['world.chunk'], operations: ['read'], scope }],
  });
  const harness = new AuthorityWorldHarness({
    platform: testCorePlatform,
    principalId: 'reader',
    authorization,
    owner: () => owner,
    prepareChunk: async () => undefined,
    advance: async (ms) => runtime.advancePausedSession(ms),
    restore: async () => undefined,
  });
  return {
    harness,
    authorization,
    runtime,
    persistence,
    replace: (next: AuthorityWorldOwner) => {
      owner = next;
    },
  };
};

const pauseDirectory = (persistence: MemoryGamePersistence) => {
  let release!: () => void;
  let started!: () => void;
  const entered = new Promise<void>((resolve) => {
    started = resolve;
  });
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const original = persistence.inspectColumnDirectory.bind(persistence);
  vi.spyOn(persistence, 'inspectColumnDirectory').mockImplementation(async (cx, cz) => {
    started();
    await wait;
    return original(cx, cz);
  });
  return { entered, release };
};

describe('authorized column source publication', () => {
  it('captures coordinates and returns metadata without materializing an unseen column', async () => {
    const { harness, runtime, persistence } = await make();
    const load = vi.spyOn(persistence, 'loadSnapshot');
    const column: [number, number] = [9, -7];
    const pending = harness.inspect({ kind: 'column-source', column });
    column[0] = 0;
    expect(await pending).toMatchObject({
      ok: true,
      data: {
        kind: 'column-source',
        source: {
          status: 'complete',
          cx: 9,
          cz: -7,
          generatedEmptyAboveY: 51,
          entries: [],
        },
      },
      frontier: { epoch: 'column-world:1' },
    });
    expect(load).not.toHaveBeenCalled();
    expect(runtime.server.readCollisionBaseline('9,0,-7', 0).status).toBe('unavailable');
  });
  it.each([[0], [0, 1, 2], [NaN, 0], [1.5, 0], [Number.MAX_SAFE_INTEGER + 1, 0]].map((column) => ({ column })))(
    'rejects malformed coordinates %o',
    async ({ column }) => {
      const { harness, runtime } = await make();
      const source = vi.spyOn(runtime.server, 'inspectColumnSource');
      expect(await harness.inspect({ kind: 'column-source', column } as never)).toMatchObject({
        ok: false,
        error: { kind: 'validation' },
      });
      expect(source).not.toHaveBeenCalled();
    },
  );
  it('a self-only grant cannot inspect a world column and never calls the source', async () => {
    const { harness, runtime } = await make('self');
    const source = vi.spyOn(runtime.server, 'inspectColumnSource');
    expect(await harness.inspect({ kind: 'column-source', column: [0, 0] })).toMatchObject({
      ok: false,
      error: { kind: 'permission' },
    });
    expect(source).not.toHaveBeenCalled();
  });
  it.each(['edit', 'residency'] as const)(
    'pending persistent I/O does not hold the host queue; host %s supersedes its observation',
    async (action) => {
      const { harness, persistence, runtime } = await make();
      const pause = pauseDirectory(persistence);
      const result = harness.inspect({ kind: 'column-source', column: [0, 0] });
      await pause.entered;
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          harness.hostOperation(() =>
            action === 'edit' ? runtime.server.edit(0, 320000, 0, 1) : runtime.server.getChunk(0, 10000, 0),
          ),
          new Promise((_, reject) => {
            timer = setTimeout(() => reject(new Error('host queue blocked by directory')), 1000);
          }),
        ]);
      } finally {
        clearTimeout(timer);
        pause.release();
      }
      expect(await result).toMatchObject({ ok: true, data: { source: { status: 'unknown', reason: 'superseded' } } });
    },
  );
  it.each(['epoch', 'worldId', 'runtime'] as const)(
    'rejects a late result after outer %s replacement',
    async (field) => {
      const current = await make();
      const replacement = field === 'runtime' ? await make() : null;
      const pause = pauseDirectory(current.persistence);
      const result = current.harness.inspect({ kind: 'column-source', column: [0, 0] });
      await pause.entered;
      await current.harness.hostOperation(() =>
        current.replace({
          runtime: replacement?.runtime ?? current.runtime,
          worldId: field === 'worldId' ? 'other-world' : 'column-world',
          epoch: field === 'epoch' ? 'column-world:2' : 'column-world:1',
        }),
      );
      pause.release();
      expect(await result).toMatchObject({ ok: false, error: { code: 'WORLD_EPOCH_STALE', kind: 'conflict' } });
    },
  );
  it('reauthorizes publication after the directory wait', async () => {
    const { harness, persistence, authorization } = await make();
    const pause = pauseDirectory(persistence);
    const result = harness.inspect({ kind: 'column-source', column: [0, 0] });
    await pause.entered;
    vi.spyOn(authorization, 'authorize').mockReturnValue({
      allowed: false,
      code: 'WORLD_PERMISSION_DENIED',
      message: 'Read revoked.',
    });
    pause.release();
    expect(await result).toMatchObject({ ok: false, error: { kind: 'permission' } });
  });
  it('directory exceptions become structured execution errors and leave host work usable', async () => {
    const { harness, persistence } = await make();
    vi.spyOn(persistence, 'inspectColumnDirectory').mockRejectedValue(new Error('directory unavailable'));
    expect(await harness.inspect({ kind: 'column-source', column: [0, 0] })).toMatchObject({
      ok: false,
      error: { kind: 'execution' },
    });
    expect(await harness.hostOperation(() => 7)).toBe(7);
  });
});
