import { expect, it } from 'vitest';
import { AuthorityRuntime } from '../../../../../../../packages/stdlib/src/server/authority/authority-runtime';
import type { CorePlatformPorts } from '../../../../../../../packages/stdlib/src/runtime/platform-ports';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { classicWorldgenProvider } from '@seedlands/playbook-classic/worldgen';
import { classicOptions } from '../../../../fixtures/classic/content';
import { MemoryGamePersistence } from '../../../../../../../packages/stdlib/src/server/persistence/memory-game-persistence';
import { validateCropCheckpoint } from '../../../../../../../packages/stdlib/src/server/gameplay/crop-runtime';

type Runtime = Awaited<ReturnType<typeof create>>;
const cropPosition: [number, number, number] = [1, 59, 0];
const waterPosition: [number, number, number] = [3, 59, 0];
const put = (position: readonly [number, number, number], value: number) => ({
  x: position[0],
  y: position[1],
  z: position[2],
  value,
});
const create = (platform: CorePlatformPorts = testCorePlatform, persistence?: MemoryGamePersistence) =>
  AuthorityRuntime.create({
    ...classicOptions(),
    ...(persistence ? { persistence } : {}),
    worldgenProvider: classicWorldgenProvider,
    platform,
    epoch: 'classic-crop-clock',
    seedText: 'classic-crop-clock',
    initialWorldTime: 8,
    startTimeMs: 0,
    initialPlayerBodyPosition: [0.5, 60, 0.5],
  });

const plantedRuntime = async (persistence?: MemoryGamePersistence) => {
  const runtime = await create(testCorePlatform, persistence);
  await expect(
    runtime.editWorld('crop-clock-fixture', [put(cropPosition, Voxel.Farmland), put(waterPosition, Voxel.Water)]),
  ).resolves.toMatchObject({ committed: true });
  runtime.server.giveItem(runtime.playerId, { itemId: 'wheat-seeds', count: 1 });
  expect(runtime.server.crops.plant(runtime.playerId, cropPosition)).toMatchObject({
    success: true,
    crop: { stage: 0 },
  });
  return runtime;
};
const advance = (runtime: Runtime, elapsedMs: number, cadenceMs: number) => {
  for (let elapsed = 0; elapsed < elapsedMs; elapsed += cadenceMs) runtime.advanceSession(cadenceMs);
};

it('preserves fractional Authority gameplay time so crop state is independent of advance cadence', async () => {
  const coarse = await plantedRuntime();
  const fine = await plantedRuntime();

  coarse.advanceSession(10_000);
  advance(fine, 10_000, 50);

  const coarseCheckpoint = coarse.exportPortableCheckpoint().gameplay.crops;
  const fineCheckpoint = fine.exportPortableCheckpoint().gameplay.crops;
  expect(fineCheckpoint).toEqual(coarseCheckpoint);
  expect(fineCheckpoint).toMatchObject({ tick: 10 });
});

it('restores fractional progress from a portable checkpoint before advancing the next crop tick', async () => {
  const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
  const source = await plantedRuntime(persistence);
  source.advanceSession(650);
  const portable = source.exportPortableCheckpoint();
  expect(portable.gameplay.crops?.fractionalSeconds).toBeCloseTo(0.65, 10);
  await source.persistPortableCheckpoint(portable);

  const restored = await create(testCorePlatform, persistence);
  expect(restored.server.crops.checkpoint()).toEqual(source.server.crops.checkpoint());
  source.advanceSession(350);
  restored.advanceSession(350);

  expect(restored.server.crops.checkpoint()).toEqual(source.server.crops.checkpoint());
  expect(restored.server.crops.checkpoint()).toMatchObject({ tick: 1, fractionalSeconds: 0 });
});

it('defaults legacy crop checkpoints without fractional progress to zero and rejects invalid fractions', () => {
  const legacy = validateCropCheckpoint({ version: 1, tick: 4, crops: [] });
  expect(legacy).toMatchObject({ tick: 4, fractionalSeconds: 0 });
  expect(() => validateCropCheckpoint({ version: 1, tick: 0, fractionalSeconds: -0.01, crops: [] })).toThrow(
    /checkpoint is invalid/i,
  );
  expect(() => validateCropCheckpoint({ version: 1, tick: 0, fractionalSeconds: 1, crops: [] })).toThrow(
    /checkpoint is invalid/i,
  );
});

it('keeps unloaded restored crops dormant while whole elapsed ticks remain deterministic', async () => {
  const runtime = await plantedRuntime();
  await expect(runtime.editWorld('crop-clock-dry-fixture', [put(waterPosition, Voxel.Air)])).resolves.toMatchObject({
    committed: true,
  });
  runtime.server.crops.restore({
    version: 1,
    tick: 0,
    crops: [
      { position: cropPosition, stage: 0, subSeconds: 0 },
      { position: [1_000, 59, 0], stage: 0, subSeconds: 0 },
    ],
  });
  runtime.advanceSession(1_000);

  expect(runtime.server.crops.checkpoint()).toMatchObject({
    tick: 1,
    crops: [
      { position: cropPosition, stage: 0, subSeconds: 0 },
      { position: [1_000, 59, 0], stage: 0, subSeconds: 0 },
    ],
  });
});
