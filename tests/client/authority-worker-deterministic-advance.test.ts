import { describe, expect, it, vi } from 'vitest';
import { BrowserAuthorityDeterministicAdvance } from '../../apps/web/src/worker/authority-worker-deterministic-advance';
import { AuthorityWorkerDirectLogicOwner } from '../../apps/web/src/worker/authority-worker-direct-logic-owner';
import {
  DIRECT_LOGIC_PROTOCOL_VERSION,
  type DirectLogicMessage,
} from '../../apps/web/src/worker/authority-worker-direct-logic-protocol';
import { AuthorityRuntime } from '../../packages/game-core/src/server/authority/authority-runtime';
import type { AuthorityAdvanceResult } from '../../packages/game-core/src/server/authority/authority-runtime-types';
import type { WorldCommitResult } from '../../packages/game-core/src/server/game-server-types';
import { decideLogicIntents } from '../../packages/game-core/src/server/logic/logic-decision';
import type { LogicIntentBatch, LogicObservation } from '../../packages/game-core/src/server/logic/logic-protocol';
import { MemoryGamePersistence } from '../../packages/game-core/src/server/persistence/memory-game-persistence';
import { Voxel, voxelIndex } from '../../packages/game-core/src/world/voxel';
import { testCorePlatform } from '../support/core-platform';

const flatChunk = () => {
  const canonical = new Uint16Array(32 ** 3);
  for (let z = 0; z < 32; z += 1) for (let x = 0; x < 32; x += 1) canonical[voxelIndex(x, 0, z)] = Voxel.Stone;
  return canonical;
};

class PromiseTailHarness {
  private tail: Promise<unknown> = Promise.resolve();

  acceptsAutomaticLogic = () => true;
  notifyProgress = vi.fn();

  hostOperation<Result>(operation: () => Result | Promise<Result>): Promise<Result> {
    const result = this.tail.then(operation);
    this.tail = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  idle(): Promise<unknown> {
    return this.tail;
  }
}

class FakeDirectPort {
  onmessage: ((event: MessageEvent<unknown>) => void) | null = null;
  onmessageerror: (() => void) | null = null;
  readonly posts: DirectLogicMessage[] = [];
  onPost: ((message: DirectLogicMessage) => void) | null = null;

  postMessage(message: DirectLogicMessage) {
    this.posts.push(message);
    this.onPost?.(message);
  }

  start() {}
  close() {}

  emit(message: DirectLogicMessage) {
    this.onmessage?.({ data: message } as MessageEvent<unknown>);
  }
}

const batchMessage = (observation: LogicObservation): DirectLogicMessage => ({
  kind: 'direct-logic-intents',
  protocolVersion: DIRECT_LOGIC_PROTOCOL_VERSION,
  batch: decideLogicIntents(observation, { physicsHz: 60 }),
});

async function movementFixture() {
  let coordinator: BrowserAuthorityDeterministicAdvance | null = null;
  const observations: LogicObservation[] = [];
  const runtime = await AuthorityRuntime.create({
    platform: testCorePlatform,
    epoch: 'browser-deterministic-advance',
    seedText: 'browser-deterministic-advance',
    persistence: new MemoryGamePersistence({ clone: testCorePlatform.clone }),
    initialWorldTime: 9,
    startTimeMs: 0,
    initialPlayerBodyPosition: [20.5, 1, 20.5],
    onLogicObservation: (observation) => {
      observations.push(observation);
      coordinator?.publishLogicObservation(observation);
    },
  });
  const prepared = await runtime.prepareMesh(0, 0, 0);
  expect(runtime.acceptGeneratedChunk({ ...prepared, canonical: flatChunk() })).toBe(true);
  const actor = runtime.server.spawnAutonomousActor({
    id: 'browser-moving-actor',
    archetype: 'settler',
    position: [10.5, 1, 10.5],
  });
  expect(
    runtime.server.applyActorAuthorityAction(actor.id, { type: 'move-to', target: [16.5, 1, 10.5] }),
  ).toMatchObject({
    accepted: true,
  });
  runtime.pause(0);
  return {
    runtime,
    actor,
    observations,
    install(value: BrowserAuthorityDeterministicAdvance) {
      coordinator = value;
    },
  };
}

describe('Browser Authority deterministic paused advance', () => {
  it('interleaves external Logic batches with real Authority physics instead of advancing bodies with stale input', async () => {
    const fixture = await movementFixture();
    fixture.runtime.requestLogicObservation();
    fixture.runtime.advancePausedSession(1_000);
    expect(fixture.runtime.server.getEntity(fixture.actor.id)?.position[0]).toBe(10.5);

    const coordinator = new BrowserAuthorityDeterministicAdvance({
      runtime: () => fixture.runtime,
      postLogicObservation: (observation) => {
        const batch = decideLogicIntents(observation, { physicsHz: 60 });
        queueMicrotask(() => {
          coordinator.acceptLogicIntentBatch(batch);
        });
      },
      yieldTurn: testCorePlatform.yieldTurn,
      timers: testCorePlatform.timers,
    });
    fixture.install(coordinator);

    const result = await coordinator.advancePaused(1_000, true);

    expect(result.lanes.physicsSteps).toBe(60);
    expect(fixture.runtime.server.getEntity(fixture.actor.id)?.position[0]).toBeGreaterThan(10.8);
    expect(fixture.observations.length).toBeGreaterThan(1);
  });

  it('ignores stale Logic replies and waits for the exact observation before the next slice', async () => {
    const fixture = await movementFixture();
    const decisions: boolean[] = [];
    const coordinator = new BrowserAuthorityDeterministicAdvance({
      runtime: () => fixture.runtime,
      postLogicObservation: (observation) => {
        const batch = decideLogicIntents(observation, { physicsHz: 60 });
        const stale: LogicIntentBatch = { ...batch, observationSequence: Math.max(0, batch.observationSequence - 1) };
        queueMicrotask(() => {
          decisions.push(coordinator.acceptLogicIntentBatch(stale));
          queueMicrotask(() => decisions.push(coordinator.acceptLogicIntentBatch(batch)));
        });
      },
      yieldTurn: testCorePlatform.yieldTurn,
      timers: testCorePlatform.timers,
    });
    fixture.install(coordinator);

    await coordinator.advancePaused(200, true);

    expect(decisions).toContain(false);
    expect(decisions).toContain(true);
    expect(fixture.runtime.server.getEntity(fixture.actor.id)?.position[0]).toBeGreaterThan(10.5);
  });

  it('does not let a prelude or stale reply replace the exact slice wait', async () => {
    const prelude = { epoch: 'fake-epoch', observationSequence: 1, physicsTick: 4 } as LogicObservation;
    const exact = { epoch: 'fake-epoch', observationSequence: 2, physicsTick: 20 } as LogicObservation;
    const commitA = { worldRevision: 1 } as WorldCommitResult;
    const commitB = { worldRevision: 2 } as WorldCommitResult;
    const advanceCalls: number[] = [];
    const received: number[] = [];
    const setTimer = vi.fn(() => Symbol('timer'));
    const clearTimer = vi.fn();
    const postLogicObservation = vi.fn();
    const runtime = {
      server: { queryEntities: () => [] },
      requestLogicObservation: vi.fn(),
      advancePausedSession: (elapsedMs: number) => {
        advanceCalls.push(elapsedMs);
        coordinator.publishLogicObservation(elapsedMs === 0 ? prelude : exact);
        return {
          lanes:
            elapsedMs === 0
              ? { physicsSteps: 1, gameplayPeriods: 2, fluidPeriods: 3 }
              : { physicsSteps: 4, gameplayPeriods: 5, fluidPeriods: 6 },
          commits: elapsedMs === 0 ? [commitA] : [commitB],
        } as unknown as AuthorityAdvanceResult;
      },
      receiveLogicIntentBatch: (batch: LogicIntentBatch) => {
        received.push(batch.observationSequence);
        return true;
      },
      snapshot: () => ({ physicsTick: 20 }),
      view: () => ({}),
      invalidateLogicCandidates: vi.fn(),
    } as unknown as AuthorityRuntime;
    const coordinator = new BrowserAuthorityDeterministicAdvance({
      runtime: () => runtime,
      postLogicObservation,
      yieldTurn: testCorePlatform.yieldTurn,
      timers: { set: setTimer, clear: clearTimer },
    });
    const batch = (observation: LogicObservation): LogicIntentBatch => ({
      protocolVersion: 1,
      epoch: observation.epoch,
      observationSequence: observation.observationSequence,
      expiresAtPhysicsTick: observation.physicsTick + 12,
      intents: [],
    });

    const advance = coordinator.advancePaused(100, true);
    let settled = false;
    void advance.then(() => (settled = true));
    expect(advanceCalls).toEqual([0, 100]);
    expect(setTimer).toHaveBeenCalledOnce();
    expect(postLogicObservation).toHaveBeenNthCalledWith(1, prelude);
    expect(postLogicObservation).toHaveBeenNthCalledWith(2, exact);
    expect(coordinator.acceptLogicIntentBatch(batch(prelude))).toBe(true);
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(clearTimer).not.toHaveBeenCalled();
    expect(coordinator.acceptLogicIntentBatch(batch(exact))).toBe(true);

    const result = await advance;
    expect(received).toEqual([1, 2]);
    expect(clearTimer).toHaveBeenCalledOnce();
    expect(result.lanes).toEqual({ physicsSteps: 5, gameplayPeriods: 7, fluidPeriods: 9 });
    expect(result.commits).toEqual([commitA, commitB]);
  });

  it('keeps a newly published Logic candidate valid while promoting an older queued response after paused debt', async () => {
    const fixture = await movementFixture();
    const harness = new PromiseTailHarness();
    const port = new FakeDirectPort();
    const results: {
      sequence: number;
      observationPhysicsTick: number;
      expiresAtPhysicsTick: number;
      receivedAtPhysicsTick: number;
      accepted: boolean;
    }[] = [];
    const receive = fixture.runtime.receiveLogicIntentBatch.bind(fixture.runtime);
    vi.spyOn(fixture.runtime, 'receiveLogicIntentBatch').mockImplementation((candidate, binding) => {
      const accepted = receive(candidate, binding);
      results.push({
        sequence: candidate.observationSequence,
        observationPhysicsTick:
          fixture.observations.find((observation) => observation.observationSequence === candidate.observationSequence)
            ?.physicsTick ?? -1,
        expiresAtPhysicsTick: candidate.expiresAtPhysicsTick,
        receivedAtPhysicsTick: fixture.runtime.snapshot().physicsTick,
        accepted,
      });
      return accepted;
    });
    let expire: (() => void) | undefined;
    const ingress = { logic: vi.fn() } as never;
    const coordinator = new BrowserAuthorityDeterministicAdvance({
      runtime: () => fixture.runtime,
      postLogicObservation: (observation) => owner.publish(observation, () => {}),
      yieldTurn: testCorePlatform.yieldTurn,
      timers: {
        set: (callback) => {
          expire = callback;
          return callback;
        },
        clear: (handle) => {
          if (expire === handle) expire = undefined;
        },
      },
    });
    const owner = new AuthorityWorkerDirectLogicOwner({
      state: () => ({
        runtime: fixture.runtime,
        harness: harness as never,
        ingress,
        advance: coordinator,
      }),
      now: () => 0,
      diagnostics: vi.fn(),
      fatal: vi.fn(),
    });
    fixture.install(coordinator);
    owner.attach({
      kind: 'attach-direct-logic',
      protocolVersion: DIRECT_LOGIC_PROTOCOL_VERSION,
      epoch: fixture.runtime.snapshot().epoch,
      port: port as unknown as MessagePort,
    });

    fixture.runtime.resume(0);
    fixture.runtime.requestLogicObservation();
    fixture.runtime.wake(500);
    fixture.runtime.pause(500);
    expect(fixture.runtime.snapshot().physicsDebtMs).toBeGreaterThan(200);
    const first = fixture.observations.at(-1)!;
    expect(port.posts).toHaveLength(1);
    let resolveNextObservation!: (observation: LogicObservation) => void;
    const nextObservation = new Promise<LogicObservation>((resolve) => {
      resolveNextObservation = resolve;
    });
    port.onPost = (message) => {
      if (message.kind !== 'direct-logic-observation') return;
      resolveNextObservation(message.observation);
      queueMicrotask(() => port.emit(batchMessage(message.observation)));
    };

    const advance = harness.hostOperation(() => coordinator.advancePaused(100, true));
    let settled = false;
    void advance.then(
      () => (settled = true),
      () => (settled = true),
    );
    port.emit(batchMessage(first));
    const second = await nextObservation;
    await Promise.resolve();
    await Promise.resolve();
    if (!settled) await testCorePlatform.yieldTurn();
    if (!settled) expire?.();
    const outcome = await advance.then(
      () => 'resolved',
      (error: Error) => error.message,
    );
    await harness.idle();
    owner.close();

    expect(
      port.posts
        .filter((message) => message.kind === 'direct-logic-observation')
        .map((message) => message.observation.observationSequence),
    ).toEqual([first.observationSequence, first.observationSequence + 1]);
    expect(results.map(({ sequence }) => sequence)).toEqual([first.observationSequence, second.observationSequence]);
    expect(results[0]).toEqual({
      sequence: first.observationSequence,
      observationPhysicsTick: first.physicsTick,
      expiresAtPhysicsTick: first.physicsTick + 12,
      receivedAtPhysicsTick: second.physicsTick,
      accepted: false,
    });
    expect(results.at(-1), JSON.stringify(results)).toEqual({
      sequence: second.observationSequence,
      observationPhysicsTick: second.physicsTick,
      expiresAtPhysicsTick: second.physicsTick + 12,
      receivedAtPhysicsTick: expect.any(Number),
      accepted: true,
    });
    expect(results.at(-1)!.receivedAtPhysicsTick).toBeLessThanOrEqual(results.at(-1)!.expiresAtPhysicsTick);
    expect(outcome).toBe('resolved');
  });

  it('settles existing paused debt at elapsed zero without requesting Logic', async () => {
    const fixture = await movementFixture();
    const postLogicObservation = vi.fn();
    const coordinator = new BrowserAuthorityDeterministicAdvance({
      runtime: () => fixture.runtime,
      postLogicObservation,
      yieldTurn: testCorePlatform.yieldTurn,
      timers: testCorePlatform.timers,
    });
    fixture.install(coordinator);
    const beforeInvalid = fixture.runtime.snapshot();
    await expect(coordinator.advancePaused(-1, false)).rejects.toThrow('within 0..60000ms');
    expect(fixture.runtime.snapshot()).toEqual(beforeInvalid);
    fixture.runtime.resume(0);
    fixture.runtime.wake(500);
    fixture.runtime.pause(500);
    expect(fixture.runtime.snapshot().physicsDebtMs).toBeGreaterThan(200);

    const result = await coordinator.advancePaused(0, false);

    expect(result.lanes.physicsSteps).toBeGreaterThan(0);
    expect(result.snapshot.physicsDebtMs).toBeLessThan(1_000 / 60);
    expect(postLogicObservation).not.toHaveBeenCalled();
    expect(coordinator.isAdvancing).toBe(false);
  });

  it('cleans the advance state when an exact observation cannot be posted', async () => {
    const fixture = await movementFixture();
    const setTimer = vi.fn(testCorePlatform.timers.set);
    const coordinator = new BrowserAuthorityDeterministicAdvance({
      runtime: () => fixture.runtime,
      postLogicObservation: () => {
        throw new Error('direct-port-failed');
      },
      yieldTurn: testCorePlatform.yieldTurn,
      timers: { set: setTimer, clear: testCorePlatform.timers.clear },
    });
    fixture.install(coordinator);
    fixture.runtime.resume(0);
    fixture.runtime.wake(500);
    fixture.runtime.pause(500);

    await expect(coordinator.advancePaused(100, true)).rejects.toThrow('direct-port-failed');
    expect(setTimer).toHaveBeenCalledOnce();
    expect(coordinator.isAdvancing).toBe(false);
    await expect(coordinator.advancePaused(0, false)).resolves.toBeDefined();
  });

  it('bounds a thrown exact acceptance with the existing response timeout', async () => {
    const fixture = await movementFixture();
    let expire: (() => void) | undefined;
    let attempted!: (error: Error | null) => void;
    const acceptanceAttempted = new Promise<Error | null>((resolve) => {
      attempted = resolve;
    });
    const receive = vi.spyOn(fixture.runtime, 'receiveLogicIntentBatch').mockImplementation(() => {
      throw new Error('accept-failed');
    });
    const coordinator = new BrowserAuthorityDeterministicAdvance({
      runtime: () => fixture.runtime,
      postLogicObservation: (observation) => {
        queueMicrotask(() => {
          let acceptanceError: Error | null = null;
          try {
            coordinator.acceptLogicIntentBatch(decideLogicIntents(observation, { physicsHz: 60 }));
          } catch (error) {
            acceptanceError = error as Error;
          } finally {
            attempted(acceptanceError);
          }
        });
      },
      yieldTurn: testCorePlatform.yieldTurn,
      timers: {
        set: (callback) => {
          expire = callback;
          return callback;
        },
        clear: (handle) => {
          if (expire === handle) expire = undefined;
        },
      },
    });
    fixture.install(coordinator);

    const outcome = coordinator.advancePaused(100, true).then(
      () => 'resolved',
      (error: Error) => error.message,
    );
    const acceptanceError = await acceptanceAttempted;
    expect(acceptanceError?.message).toBe('accept-failed');
    expire!();

    await expect(outcome).resolves.toContain('timed out');
    expect(coordinator.isAdvancing).toBe(false);
    receive.mockRestore();
  });

  it('invalidates a timed-out Logic candidate before failure and admits a fresh advance', async () => {
    const fixture = await movementFixture();
    let expire: (() => void) | undefined;
    let received!: () => void;
    const observed = new Promise<void>((resolve) => {
      received = resolve;
    });
    let late!: LogicIntentBatch;
    let reply = false;
    const coordinator = new BrowserAuthorityDeterministicAdvance({
      runtime: () => fixture.runtime,
      postLogicObservation: (observation) => {
        const batch = decideLogicIntents(observation, { physicsHz: 60 });
        if (reply) queueMicrotask(() => coordinator.acceptLogicIntentBatch(batch));
        else {
          late = batch;
          received();
        }
      },
      yieldTurn: testCorePlatform.yieldTurn,
      timers: {
        ...testCorePlatform.timers,
        set: (callback) => {
          expire = callback;
          return 0;
        },
        clear: () => {},
      },
    });
    fixture.install(coordinator);
    const failed = expect(coordinator.advancePaused(200, true)).rejects.toThrow('timed out');
    await observed;
    expire!();
    await failed;
    expect(coordinator.isAdvancing).toBe(false);
    const before = fixture.runtime.snapshot();
    // Use the ordinary runtime ingress, exactly as the Worker does after the advance has returned.
    expect(fixture.runtime.receiveLogicIntentBatch(late)).toBe(false);
    expect(fixture.runtime.snapshot()).toEqual(before);
    reply = true;
    await coordinator.advancePaused(300, true);
    expect(fixture.runtime.server.getEntity(fixture.actor.id)?.position[0]).toBeGreaterThan(10.5);
  });

  it('waits for generated collision residency before advancing the real body', async () => {
    const holder: { runtime?: AuthorityRuntime; coordinator?: BrowserAuthorityDeterministicAdvance } = {};
    const requested: string[] = [];
    const runtime = await AuthorityRuntime.create({
      platform: testCorePlatform,
      epoch: 'browser-generated-collision',
      seedText: 'browser-generated-collision',
      persistence: new MemoryGamePersistence({ clone: testCorePlatform.clone }),
      initialWorldTime: 9,
      startTimeMs: 0,
      initialPlayerBodyPosition: [20.5, 1, 20.5],
      onUnknownChunk: (key) => {
        requested.push(key);
        const [cx, cy, cz] = key.split(',').map(Number) as [number, number, number];
        void holder.runtime!.prepareMesh(cx, cy, cz).then((prepared) =>
          holder.runtime!.acceptGeneratedChunk({
            ...prepared,
            canonical: cy === 0 ? flatChunk() : new Uint16Array(32 ** 3),
          }),
        );
      },
      onLogicObservation: (observation) => holder.coordinator!.publishLogicObservation(observation),
    });
    holder.runtime = runtime;
    const actor = runtime.server.spawnAutonomousActor({
      id: 'generated-collision-actor',
      archetype: 'settler',
      position: [10.5, 1, 10.5],
    });
    runtime.server.applyActorAuthorityAction(actor.id, { type: 'move-to', target: [16.5, 1, 10.5] });
    runtime.pause(0);
    const coordinator = new BrowserAuthorityDeterministicAdvance({
      runtime: () => runtime,
      postLogicObservation: (observation) =>
        queueMicrotask(() => coordinator.acceptLogicIntentBatch(decideLogicIntents(observation, { physicsHz: 60 }))),
      yieldTurn: testCorePlatform.yieldTurn,
      timers: testCorePlatform.timers,
    });
    holder.coordinator = coordinator;

    await coordinator.advancePaused(300, true);

    expect(requested).toContain('0,0,0');
    expect(runtime.readCollisionBaseline('0,0,0', 0)).toMatchObject({ status: 'available' });
    expect(runtime.server.getEntity(actor.id)?.position[0]).toBeGreaterThan(10.5);
  });
});
