import { expect, it } from 'vitest';
import { classicWorldgenProvider } from '@seedlands/playbook-classic/worldgen';
import { BrowserAuthorityDeterministicAdvance } from '../../../src/worker/authority-worker-deterministic-advance';
import { AuthorityRuntime } from '../../../../../packages/stdlib/src/server/authority/authority-runtime';
import { loadHeadlessEntityChunks } from '../../../../../packages/stdlib/src/server/headless/headless-chunk-loader';
import { decideLogicIntents } from '../../../../../packages/stdlib/src/server/logic/logic-decision';
import type { LogicObservation } from '../../../../../packages/stdlib/src/server/logic/logic-protocol';
import { Voxel, voxelIndex } from '../../../../../packages/stdlib/src/world/voxel';
import { testCorePlatform } from '../../../../../packages/stdlib/tests/support/core-platform';
import { classicOptions } from '../../fixtures/classic/content';

async function configuredBodyFixture() {
  let coordinator: BrowserAuthorityDeterministicAdvance | null = null;
  const observations: LogicObservation[] = [];
  const runtime = await AuthorityRuntime.create({
    ...classicOptions(),
    worldgenProvider: classicWorldgenProvider,
    platform: testCorePlatform,
    epoch: 'configured-body-preload',
    seedText: 'configured-body-preload',
    initialWorldTime: 9,
    startTimeMs: 0,
    initialPlayerBodyPosition: [20.5, 1, 20.5],
    onLogicObservation: (observation) => {
      observations.push(observation);
      coordinator?.publishLogicObservation(observation);
    },
  });
  const canonical = new Uint16Array(32 ** 3);
  for (let z = 0; z < 32; z++) for (let x = 0; x < 32; x++) canonical[voxelIndex(x, 0, z)] = Voxel.Stone;
  const prepared = await runtime.prepareMesh(0, 0, 0);
  expect(runtime.acceptGeneratedChunk({ ...prepared, canonical })).toBe(true);
  runtime.pause(0);
  return {
    runtime,
    observations,
    install: (value: BrowserAuthorityDeterministicAdvance) => {
      coordinator = value;
    },
  };
}

it('loads configured carrier chunks for both headless and Browser advance without fixed BodyKind', async () => {
  const fixture = await configuredBodyFixture();
  const carrier = fixture.runtime.server.spawnEntity({
    id: 'configured-carrier',
    type: 'transport',
    position: [32, 33, 32],
    transport: {
      definitionId: 'seedlands:minecart',
      yaw: Math.PI / 2,
      routeCursor: {
        family: 'seedlands:ordinary-rail',
        cell: [32, 33, 32],
        variant: 'seedlands:rail-north-south',
        entry: { side: 'north', elevation: 0 },
        exit: { side: 'south', elevation: 0 },
        progress: 0.5,
        segmentLength: 1,
      },
      rider: null,
      fuel: null,
      inventory: [],
    },
  });
  const state = { pending: new Set<string>(), loaded: new Set(['0,0,0']) };
  await loadHeadlessEntityChunks(fixture.runtime, testCorePlatform, state);
  for (const key of ['0,1,0', '1,1,0', '0,1,1', '1,1,1']) expect(state.loaded.has(key)).toBe(true);
  const coordinator = new BrowserAuthorityDeterministicAdvance({
    runtime: () => fixture.runtime,
    postLogicObservation: (observation) =>
      queueMicrotask(() => coordinator.acceptLogicIntentBatch(decideLogicIntents(observation, { physicsHz: 60 }))),
    yieldTurn: testCorePlatform.yieldTurn,
    timers: testCorePlatform.timers,
  });
  fixture.install(coordinator);
  const result = await coordinator.advancePaused(100, true);
  expect(result.lanes.physicsSteps).toBe(6);
  expect(fixture.observations.at(-1)?.entities.find(({ id }) => id === carrier.id)).toMatchObject({ bodyKind: null });
});
