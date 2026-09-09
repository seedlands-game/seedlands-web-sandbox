import { describe, expect, it } from 'vitest';
import { HeadlessSession } from '../../packages/game-core/src/server/headless/headless-session';
import { Voxel } from '../../packages/game-core/src/world/voxel';
import { testCorePlatform } from '../support/core-platform';
import type { CorePlatformPorts } from '../../packages/game-core/src/runtime/platform-ports';

describe('shared world harness', () => {
  it('runs the Headless wall clock through the serialized queue and cannot rearm after stop', async () => {
    let now = 0;
    let sequence = 0;
    const callbacks = new Map<number, () => void>();
    const platform: CorePlatformPorts = {
      ...testCorePlatform,
      now: () => now,
      timers: {
        set: (callback) => {
          const id = ++sequence;
          callbacks.set(id, callback);
          return id;
        },
        clear: (handle) => callbacks.delete(handle as number),
      },
    };
    const fire = (id: number) => {
      const callback = callbacks.get(id);
      callbacks.delete(id);
      callback?.();
    };
    const session = await HeadlessSession.create({ platform, seedText: 'world-harness-wall-clock' });
    await session.world.clock({ kind: 'pause' });
    session.startClock();
    const pausedTimer = [...callbacks.keys()][0]!;
    now = 1_000;
    fire(pausedTimer);
    await session.world.idle();
    expect(session.runtime.snapshot().physicsTick).toBe(0);

    await session.world.clock({ kind: 'run' });
    const runningTimer = [...callbacks.keys()][0]!;
    now = 2_000;
    fire(runningTimer);
    await session.world.idle();
    expect(session.runtime.snapshot().physicsTick).toBe(60);

    const staleTimer = [...callbacks.keys()][0]!;
    now = 3_000;
    fire(staleTimer);
    session.stopClock();
    await session.world.idle();
    await Promise.resolve();
    expect(callbacks.size).toBe(0);
    expect(session.clockFailure).toBeNull();
    await session.dispose();
  }, 20_000);

  it('returns structured validation errors for malformed method arguments without throwing', async () => {
    const session = await HeadlessSession.create({ platform: testCorePlatform, seedText: 'world-harness-invalid' });
    const invalidCalls = [
      session.world.inspect(null as never),
      session.world.prepare(null as never),
      session.world.command(null as never),
      session.world.clock(null as never),
      session.world.logic(null as never),
      session.world.actions(null as never),
      session.world.barrier(null as never),
      session.world.trace(null as never),
      session.world.checkpoint(null as never),
    ];
    for (const result of await Promise.all(invalidCalls))
      expect(result).toMatchObject({ ok: false, error: { kind: 'validation' } });
  });

  it('rejects malformed Logic mode and batches without mutating mode or consuming the candidate', async () => {
    const session = await HeadlessSession.create({
      platform: testCorePlatform,
      seedText: 'world-harness-logic-invalid',
    });
    expect(await session.world.logic({ kind: 'mode', mode: 'bogus' } as never)).toMatchObject({
      ok: false,
      error: { code: 'WORLD_REQUEST_INVALID', kind: 'validation' },
    });
    expect(await session.world.logic({ kind: 'observe' })).toMatchObject({ ok: true, data: { mode: 'automatic' } });
    await session.world.logic({ kind: 'mode', mode: 'scripted' });
    const observed = await session.world.logic({ kind: 'observe' });
    if (!observed.ok || !('observation' in observed.data) || !observed.data.observation)
      throw new Error('Logic observation unavailable.');
    const observation = observed.data.observation;
    expect(await session.world.logic({ kind: 'submit', batch: null } as never)).toMatchObject({
      ok: false,
      error: { code: 'WORLD_REQUEST_INVALID', kind: 'validation' },
    });
    expect(
      await session.world.logic({
        kind: 'submit',
        batch: {
          protocolVersion: 1,
          epoch: observation.epoch,
          observationSequence: observation.observationSequence,
          expiresAtPhysicsTick: observation.physicsTick + 1,
          intents: [],
        },
      }),
    ).toMatchObject({ ok: true, data: { accepted: true, mode: 'scripted' } });
  }, 20_000);

  it('keeps one world identity across commands, inspection and deterministic paused advancement', async () => {
    const session = await HeadlessSession.create({ platform: testCorePlatform, seedText: 'world-harness-session' });
    const world = session.world;
    const first = await world.identity();
    expect(first.ok).toBe(true);
    if (!first.ok) throw new Error(first.error.message);

    expect((await world.clock({ kind: 'pause' })).ok).toBe(true);
    const pausedTick = session.runtime.snapshot().physicsTick;
    session.runtime.wake(20_000);
    expect(session.runtime.snapshot().physicsTick).toBe(pausedTick);

    expect(
      await world.command({ type: 'set-block', position: [33, 30, 1], voxel: Voxel.Wood }, { sequence: 1 }),
    ).toMatchObject({ ok: true });
    expect(await world.inspect({ kind: 'voxel', position: [33, 30, 1] })).toMatchObject({
      ok: true,
      data: { voxel: Voxel.Wood },
    });
    const advanced = await world.clock({ kind: 'advance', elapsedMs: 1_000 });
    expect(advanced).toMatchObject({ ok: true, data: { lanes: { physicsSteps: 60, gameplayPeriods: 20 } } });
    const laterIdentity = await world.identity();
    expect(laterIdentity, JSON.stringify(laterIdentity)).toMatchObject({
      ok: true,
      data: { worldId: first.data.worldId },
    });
    expect(await world.clock({ kind: 'run' })).toMatchObject({ ok: true, data: { paused: false } });
    expect(await world.clock({ kind: 'advance', elapsedMs: 1 })).toMatchObject({
      ok: false,
      error: { code: 'WORLD_CLOCK_RUNNING' },
    });
  }, 20_000);

  it('restores a portable checkpoint atomically with a new epoch', async () => {
    const source = await HeadlessSession.create({ platform: testCorePlatform, seedText: 'portable-world' });
    expect((await source.world.clock({ kind: 'pause' })).ok).toBe(true);
    expect(
      await source.world.command({ type: 'set-block', position: [2, 30, 2], voxel: Voxel.Wood }, { sequence: 1 }),
    ).toMatchObject({ ok: true });
    const exported = await source.world.checkpoint({ kind: 'export' });
    expect(exported.ok).toBe(true);
    if (!exported.ok) throw new Error(exported.error.message);

    const target = await HeadlessSession.create({ platform: testCorePlatform, seedText: 'other-world' });
    const oldIdentity = await target.world.identity();
    expect(oldIdentity.ok).toBe(true);
    const restored = await target.world.checkpoint({ kind: 'restore', snapshot: exported.data.snapshot });
    expect(restored).toMatchObject({ ok: true });
    const newIdentity = await target.world.identity();
    expect(newIdentity.ok).toBe(true);
    if (!oldIdentity.ok || !newIdentity.ok) throw new Error('identity unavailable');
    expect(newIdentity.data.epoch).not.toBe(oldIdentity.data.epoch);
    expect(newIdentity.data.seedText).toBe('portable-world');
    expect(await target.world.inspect({ kind: 'voxel', position: [2, 30, 2] })).toMatchObject({
      ok: true,
      data: { voxel: Voxel.Wood },
    });

    const beforeBadRestore = newIdentity.data;
    expect(await target.world.checkpoint({ kind: 'restore', snapshot: { version: 999 } })).toMatchObject({
      ok: false,
      error: { code: 'WORLD_CHECKPOINT_INVALID' },
    });
    expect(await target.world.identity()).toMatchObject({ ok: true, data: beforeBadRestore });
  }, 30_000);

  it('rejects an operation submitted behind a restore against its captured epoch', async () => {
    const source = await HeadlessSession.create({ platform: testCorePlatform, seedText: 'epoch-source' });
    const exported = await source.world.checkpoint({ kind: 'export' });
    if (!exported.ok) throw new Error(exported.error.message);
    const target = await HeadlessSession.create({ platform: testCorePlatform, seedText: 'epoch-target' });
    const restoring = target.world.checkpoint({ kind: 'restore', snapshot: exported.data.snapshot });
    const staleCommand = target.world.command({ type: 'set-block', position: [1, 30, 1], voxel: Voxel.Wood });
    expect(await restoring).toMatchObject({ ok: true });
    expect(await staleCommand).toMatchObject({
      ok: false,
      error: { code: 'WORLD_EPOCH_STALE', kind: 'conflict' },
    });
    await source.dispose();
    await target.dispose();
  }, 30_000);

  it('rejects a waiting barrier when restore replaces its epoch', async () => {
    const source = await HeadlessSession.create({ platform: testCorePlatform, seedText: 'barrier-restore-source' });
    const exported = await source.world.checkpoint({ kind: 'export' });
    if (!exported.ok) throw new Error(exported.error.message);
    const target = await HeadlessSession.create({ platform: testCorePlatform, seedText: 'barrier-restore-target' });
    const identity = await target.world.identity();
    if (!identity.ok) throw new Error(identity.error.message);
    const waiting = target.world.barrier({
      kind: 'committed',
      frontier: { ...identity.frontier, commitSequence: identity.frontier.commitSequence + 10 },
      timeoutMs: 2_000,
    });
    expect(await target.world.checkpoint({ kind: 'restore', snapshot: exported.data.snapshot })).toMatchObject({
      ok: true,
    });
    expect(await waiting).toMatchObject({
      ok: false,
      error: { code: 'WORLD_BARRIER_STALE_EPOCH', kind: 'conflict' },
    });
    await source.dispose();
    await target.dispose();
  }, 30_000);

  it('rejects stale frontiers and bounds trace retention', async () => {
    const session = await HeadlessSession.create({ platform: testCorePlatform, seedText: 'world-harness-frontier' });
    const identity = await session.world.identity();
    if (!identity.ok) throw new Error(identity.error.message);
    expect(
      await session.world.barrier({
        kind: 'committed',
        frontier: { ...identity.frontier, epoch: 'stale-epoch' },
        timeoutMs: 0,
      }),
    ).toMatchObject({ ok: false, error: { code: 'WORLD_BARRIER_STALE_EPOCH' } });

    for (let sequence = 1; sequence <= 300; sequence += 1) await session.world.identity();
    const trace = await session.world.trace({ kind: 'read', limit: 999 });
    expect(trace).toMatchObject({ ok: true });
    if (!trace.ok) throw new Error(trace.error.message);
    expect(trace.data.events.length).toBeLessThanOrEqual(256);
    expect(await session.world.trace({ kind: 'read', limit: 0 })).toMatchObject({ ok: true, data: { events: [] } });
  }, 20_000);

  it('lets later operations satisfy event-driven barriers and only ACKs persisted checkpoints', async () => {
    const session = await HeadlessSession.create({ platform: testCorePlatform, seedText: 'world-harness-barriers' });
    await session.world.clock({ kind: 'pause' });
    const identity = await session.world.identity();
    if (!identity.ok) throw new Error(identity.error.message);
    const future = { ...identity.frontier, physicsTick: identity.frontier.physicsTick + 1 };
    const waiting = session.world.barrier({ kind: 'settled', frontier: future, timeoutMs: 2_000 });
    await session.world.clock({ kind: 'advance', elapsedMs: 20 });
    expect(await waiting).toMatchObject({ ok: true, data: { reached: true, kind: 'settled' } });

    const finiteFrontier = await session.world.identity();
    if (!finiteFrontier.ok) throw new Error(finiteFrontier.error.message);
    expect(await session.world.logic({ kind: 'observe' })).toMatchObject({ ok: true });
    expect(
      await session.world.barrier({ kind: 'settled', frontier: finiteFrontier.frontier, timeoutMs: 0 }),
    ).toMatchObject({
      ok: true,
      data: { kind: 'settled' },
    });

    const exported = await session.world.checkpoint({ kind: 'export' });
    if (!exported.ok) throw new Error(exported.error.message);
    expect(
      await session.world.barrier({ kind: 'checkpoint', frontier: exported.frontier, timeoutMs: 0 }),
    ).toMatchObject({
      ok: true,
      data: { kind: 'checkpoint' },
    });

    const failing = await HeadlessSession.create({
      platform: testCorePlatform,
      seedText: 'world-harness-save-failure',
    });
    failing.persistence.saveFrozenSnapshot = async () => {
      throw new Error('durable save failed');
    };
    const before = await failing.world.identity();
    if (!before.ok) throw new Error(before.error.message);
    expect(await failing.world.checkpoint({ kind: 'export' })).toMatchObject({
      ok: false,
      error: { code: 'WORLD_EXECUTION_FAILED' },
    });
    expect(await failing.world.barrier({ kind: 'checkpoint', frontier: before.frontier, timeoutMs: 0 })).toMatchObject({
      ok: false,
      error: { code: 'WORLD_BARRIER_TIMEOUT' },
    });
  }, 30_000);

  it('authorizes action ids against their actual actor owner', async () => {
    const source = await HeadlessSession.create({ platform: testCorePlatform, seedText: 'world-action-owner' });
    expect(
      await source.world.command({ type: 'spawn-actor', id: 'foreign', archetype: 'settler', position: [3, 30, 3] }),
    ).toMatchObject({ ok: true });
    expect(await source.world.command({ type: 'start-action', entityId: 'foreign', action: 'idle' })).toMatchObject({
      ok: true,
    });
    const foreign = source.runtime.server.getActorAction('foreign');
    expect(foreign).not.toBeNull();
    const checkpoint = await source.world.checkpoint({ kind: 'export' });
    if (!checkpoint.ok || !foreign) throw new Error('fixture unavailable');
    const playerId = source.runtime.playerId;
    const target = await HeadlessSession.create({
      platform: testCorePlatform,
      seedText: 'world-action-target',
      worldHarness: {
        principalId: 'restricted-player',
        authorization: {
          principals: [{ id: 'restricted-player', boundEntityId: playerId }],
          rules: [
            {
              effect: 'allow',
              principal: { ids: ['restricted-player'] },
              resources: ['world.checkpoint'],
              operations: ['restore'],
              scope: 'any',
            },
            {
              effect: 'allow',
              principal: { ids: ['restricted-player'] },
              resources: ['world.action'],
              operations: ['read'],
              scope: 'self',
            },
          ],
        },
      },
    });
    expect(await target.world.checkpoint({ kind: 'restore', snapshot: checkpoint.data.snapshot })).toMatchObject({
      ok: true,
    });
    expect(await target.world.actions({ entityId: playerId, actionId: foreign.id })).toMatchObject({
      ok: false,
      error: { code: 'WORLD_PERMISSION_DENIED', kind: 'permission' },
    });
    expect(await target.world.actions({ entityId: playerId, actionId: 'missing-action' })).toMatchObject({
      ok: false,
      error: { code: 'WORLD_PERMISSION_DENIED', kind: 'permission' },
    });
    expect(
      await target.world.command({ type: 'query-action', entityId: playerId, actionId: foreign.id }),
    ).toMatchObject({
      ok: false,
      error: { code: 'WORLD_PERMISSION_DENIED', kind: 'permission' },
    });
    expect(
      await target.world.command({ type: 'query-action', entityId: playerId, actionId: 'missing-action' }),
    ).toMatchObject({
      ok: false,
      error: { code: 'WORLD_PERMISSION_DENIED', kind: 'permission' },
    });
  }, 30_000);
});
