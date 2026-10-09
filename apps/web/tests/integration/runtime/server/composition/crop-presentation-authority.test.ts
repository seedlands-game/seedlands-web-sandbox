import type { AuthorityAction } from '../../../../../../../packages/stdlib/src/server/protocol/authority-worker-protocol';
import type { CompositionCheckpointIdentity } from '@seedlands/stdlib/mod-api';
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { AuthorityRuntime } from '../../../../../../../packages/stdlib/src/server/authority/authority-runtime';
import type { CorePlatformPorts } from '../../../../../../../packages/stdlib/src/runtime/platform-ports';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { MemoryGamePersistence } from '../../../../../../../packages/stdlib/src/server/persistence/memory-game-persistence';
import {
  assembleOverworldPacks,
  createGameplayActorAuthority,
  createGameplaySystemAuthority,
} from '@seedlands/stdlib/host';
import { defineCropInteractionModule } from '@seedlands/stdlib/mod-api';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { classicWorldgenProvider } from '@seedlands/playbook-classic/worldgen';
import { classicOptions } from '../../../../fixtures/classic/content';
import { pack as classicPack } from '../../../../../../../playbooks/classic/src/pack';
import { classicCropConfig } from '../../../../../../../playbooks/classic/src/crop-policy';

type Runtime = Awaited<ReturnType<typeof create>>;
type Position = [number, number, number];
const hit: Position = [1, 59, 0];
const above: Position = [1, 60, 0];
const side: Position = [1, 59, 1];
const prePresentationIdentity = () =>
  JSON.parse(
    readFileSync(
      new URL(
        '../../../../../../../changes/2026-10-08-pr41-ci-recovery/evidence/pre-crop-presentation-v4-browser22-01.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ) as CompositionCheckpointIdentity;
const legacyComposition = () => {
  const cropConfig = { ...classicCropConfig } as typeof classicCropConfig & { presentationId?: string };
  delete cropConfig.presentationId;
  const modules = classicPack.modules.map((module) =>
    module.descriptor.id === classicCropConfig.moduleId ? defineCropInteractionModule(cropConfig) : module,
  );
  return assembleOverworldPacks([
    {
      ...classicPack,
      manifest: { ...classicPack.manifest, modules: modules.map(({ descriptor }) => descriptor) },
      modules,
      integrity: {
        algorithm: 'sha256' as const,
        manifestDigest: 'a'.repeat(64),
        entryDigest: 'b'.repeat(64),
        resources: (classicPack.manifest.resources ?? []).map((path) => ({ path, digest: 'c'.repeat(64) })),
      },
    },
  ]);
};
const create = (
  platform: CorePlatformPorts = testCorePlatform,
  persistence?: MemoryGamePersistence,
  legacy = false,
) => {
  const base = classicOptions();
  const composition = legacy ? legacyComposition() : base.composition;
  return AuthorityRuntime.create({
    ...base,
    ...(legacy
      ? {
          composition,
          moduleActorAuthority: createGameplayActorAuthority(composition.resources, { playerAlias: 'test-player' }),
          moduleSystemAuthority: createGameplaySystemAuthority(composition),
        }
      : {}),
    ...(persistence ? { persistence } : {}),
    worldgenProvider: classicWorldgenProvider,
    platform,
    epoch: 'crop-presentation-authority',
    seedText: 'crop-presentation-authority',
    initialWorldTime: 8,
    startTimeMs: 0,
    initialPlayerBodyPosition: [0.5, 60, 0.5],
  });
};

const put = (position: readonly [number, number, number], value: number) => ({
  x: position[0],
  y: position[1],
  z: position[2],
  value,
});
const prepareCropTarget = async (runtime: Runtime) => {
  const edits = await runtime.editWorld('crop-presentation-fixture', [
    put([0, 59, 0], Voxel.Stone),
    put([0, 60, 0], Voxel.Air),
    put([0, 61, 0], Voxel.Air),
    put(hit, Voxel.Farmland),
    put(above, Voxel.Air),
    put(side, Voxel.Air),
    put([3, 59, 0], Voxel.Water),
  ]);
  expect(edits).toMatchObject({ committed: true });
  runtime.server.giveItem(runtime.playerId, { itemId: 'wheat-seeds', count: 2 });
};
const plant = (runtime: Runtime): AuthorityAction => {
  const player = runtime.server.getPlayerState(runtime.playerId);
  const inventory = runtime.server.getInventoryPointerView(runtime.playerId);
  return {
    type: 'interact',
    intent: 'use',
    target: { kind: 'voxel', hit: [...hit], adjacent: [...above] },
    expectedSelection: {
      inventoryRevision: inventory.revision,
      modeRevision: player.mode!.revision,
      creativeCatalogRevision: player.creativeCatalog!.revision,
      selectedSlot: player.selectedSlot,
    },
  };
};

it('projects the configured Pack crop identity without changing the crop checkpoint through growth and restore', async () => {
  const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
  const runtime = await create(testCorePlatform, persistence);
  await prepareCropTarget(runtime);
  const planted = await runtime.performAction(plant(runtime));
  expect(planted.result, JSON.stringify(planted.result)).toMatchObject({ success: true, handled: true });

  const initialView = runtime.view();
  expect(initialView.cropStages).toEqual([{ position: hit, stage: 0, presentationId: 'seedlands:wheat-crop' }]);
  expect(Reflect.get(runtime.server.crops, 'presentationId')).toBe('seedlands:wheat-crop');
  const plantedCheckpoint = runtime.server.crops.checkpoint();
  expect(plantedCheckpoint.crops[0]).not.toHaveProperty('presentationId');
  expect(runtime.exportPortableCheckpoint().gameplay.crops).toEqual(plantedCheckpoint);

  runtime.advanceSession(10_000);
  const grownView = runtime.view();
  expect(grownView.cropStages).toEqual([
    { position: hit, stage: expect.any(Number), presentationId: 'seedlands:wheat-crop' },
  ]);
  const grownStages = grownView.cropStages!;
  expect(grownStages[0]!.stage).toBeGreaterThan(0);
  expect(grownStages[0]).not.toHaveProperty('subSeconds');
  const grownCheckpoint = runtime.server.crops.checkpoint();
  expect(grownCheckpoint.crops[0]).not.toHaveProperty('presentationId');
  expect(runtime.exportPortableCheckpoint().gameplay.crops).toEqual(grownCheckpoint);
  await runtime.persistPortableCheckpoint(runtime.exportPortableCheckpoint());

  const restored = await create(testCorePlatform, persistence);
  await expect(restored.server.prepareCanonicalChunkForMutation(0, 1, 0)).resolves.toBe(true);
  expect(restored.server.crops.checkpoint()).toEqual(grownCheckpoint);
  expect(restored.view().cropStages).toEqual(grownStages);
  expect(Reflect.get(restored.server.crops, 'presentationId')).toBe('seedlands:wheat-crop');
});

it('preserves the legacy two-field crop projection for a configuration without presentation metadata', async () => {
  const runtime = await create(testCorePlatform, undefined, true);
  await prepareCropTarget(runtime);
  const planted = await runtime.performAction(plant(runtime));
  expect(planted.result, JSON.stringify(planted.result)).toMatchObject({ success: true, handled: true });

  expect(runtime.view().cropStages).toEqual([{ position: hit, stage: 0 }]);
  expect(Reflect.get(runtime.server.crops, 'presentationId')).toBeUndefined();
  expect(runtime.server.crops.checkpoint().crops[0]).not.toHaveProperty('presentationId');
});

it('restores only the exact captured pre-presentation V4 composition identity', async () => {
  const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
  const runtime = await create(testCorePlatform, persistence);
  await prepareCropTarget(runtime);
  expect((await runtime.performAction(plant(runtime))).result).toMatchObject({ success: true, handled: true });
  const checkpoint = runtime.exportPortableCheckpoint();
  persistence.saveFrozenSnapshot({
    ...checkpoint,
    gameplay: { ...checkpoint.gameplay, composition: prePresentationIdentity() },
  });

  const restored = await create(testCorePlatform, persistence);

  await expect(restored.server.prepareCanonicalChunkForMutation(0, 1, 0)).resolves.toBe(true);
  expect(restored.server.crops.checkpoint()).toEqual(runtime.server.crops.checkpoint());
  expect(restored.view().cropStages).toEqual([{ position: hit, stage: 0, presentationId: 'seedlands:wheat-crop' }]);
});

it.each(['entry integrity', 'definition map'] as const)(
  'rejects a captured pre-presentation identity with altered %s',
  async (field) => {
    const runtime = await create();
    const identity = prePresentationIdentity();
    const altered =
      field === 'entry integrity'
        ? {
            ...identity,
            packLock: identity.packLock.map((entry) => ({
              ...entry,
              integrity: { ...entry.integrity, entryDigest: '0'.repeat(64) },
            })),
          }
        : {
            ...identity,
            definitionMap: {
              ...identity.definitionMap,
              capabilities: identity.definitionMap.capabilities.map((capability) =>
                capability.id === 'seedlands:crop-interaction'
                  ? { ...capability, definitionIdentity: 'unapproved-crop-presentation' }
                  : capability,
              ),
            },
          };
    const checkpoint = runtime.exportPortableCheckpoint();
    const persistence = new MemoryGamePersistence({ clone: testCorePlatform.clone });
    persistence.saveFrozenSnapshot({
      ...checkpoint,
      gameplay: { ...checkpoint.gameplay, composition: altered },
    });

    await expect(create(testCorePlatform, persistence)).rejects.toThrow(/composition identity/i);
  },
);
