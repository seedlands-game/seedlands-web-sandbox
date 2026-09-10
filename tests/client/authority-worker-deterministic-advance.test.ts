import { describe, expect, it } from 'vitest';
import { BrowserAuthorityDeterministicAdvance } from '../../apps/web/src/worker/authority-worker-deterministic-advance';
import { AuthorityRuntime } from '../../packages/game-core/src/server/authority/authority-runtime';
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
