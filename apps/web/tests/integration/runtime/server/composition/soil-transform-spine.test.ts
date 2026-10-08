import { expect, it } from 'vitest';
import { assembleProductPacks, type VerifiedPackArtifact } from '@seedlands/stdlib/host';
import {
  defineContentModule,
  defineItemInteractionModule,
  definePack,
  defineSoilTransformInteractionModule,
} from '@seedlands/stdlib/mod-api';
import { HeadlessSession } from '../../../../../../../packages/stdlib/src/server/headless/headless-session';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { buildingModules } from '../../../../fixtures/packs/builder/building-content';

const pack = definePack({
  id: 'sample:soil-transform-spine',
  version: '1.0.0',
  kind: 'playbook',
  modules: [
    ...buildingModules(false).filter((module) => module.descriptor.id !== 'sample:building-content'),
    defineContentModule({
      moduleId: 'sample:soil-content',
      items: [
        { id: 'sample:stone', name: 'Stone', itemType: 'block', stackLimit: 64, capabilities: [] },
        { id: 'sample:wood', name: 'Wood', itemType: 'block', stackLimit: 64, capabilities: [] },
        {
          id: 'sample:soil-shaper',
          name: 'Soil Shaper',
          itemType: 'tool',
          stackLimit: 1,
          durability: { max: 7 },
          capabilities: [{ type: 'till' }],
        },
      ],
      voxels: [
        {
          id: 'sample:air',
          storageId: 0,
          solid: false,
          targetable: false,
          renderable: false,
          meshKind: 'cube',
          emission: 0,
          lightCost: 1,
          faceMaterials: [4, 4, 4, 4, 4, 4],
        },
        {
          id: 'sample:soil',
          storageId: 3,
          solid: true,
          targetable: true,
          renderable: true,
          meshKind: 'cube',
          emission: 0,
          lightCost: 16,
          faceMaterials: [4, 4, 4, 4, 4, 4],
        },
        {
          id: 'sample:tilled-soil',
          storageId: 4,
          solid: true,
          targetable: true,
          renderable: true,
          meshKind: 'cube',
          emission: 0,
          lightCost: 16,
          faceMaterials: [4, 4, 4, 4, 4, 4],
        },
      ],
      meleeDefinitions: [],
    }),
    defineSoilTransformInteractionModule({
      moduleId: 'sample:soil-transform',
      operationId: 'sample:transform-soil',
      sourceVoxels: [3],
      targetVoxel: 4,
      durabilityCost: 2,
      emptyAboveVoxels: [0],
    }),
    defineItemInteractionModule({
      moduleId: 'sample:soil-interactions',
      permissions: [{ resource: 'seedlands.block-voxel', operations: ['execute'] }],
      definitions: [
        {
          id: 'sample:soil-shaper-binding',
          selector: { capability: 'till' },
          trigger: 'voxel',
          operationId: 'sample:transform-soil',
          presentationKey: 'sample:soil-transform',
        },
      ],
    }),
  ],
});
const verified: VerifiedPackArtifact = {
  ...pack,
  integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
};
const approvedPlaybook = {
  id: verified.manifest.id,
  version: verified.manifest.version,
  integrity: verified.integrity,
  permissions: verified.modules.flatMap((module) => module.descriptor.permissions ?? []),
};
const create = () =>
  HeadlessSession.create({
    seedText: 'soil-transform-spine',
    platform: testCorePlatform,
    createComposition: () => assembleProductPacks([verified], { approvedPlaybook }),
  });
const action = (session: HeadlessSession, target: [number, number, number] = [0, 59, 0]) => {
  const player = session.runtime.server.getPlayerState(session.runtime.playerId);
  const inventory = session.runtime.server.getInventoryPointerView(session.runtime.playerId);
  return {
    type: 'interact' as const,
    intent: 'use' as const,
    target: {
      kind: 'voxel' as const,
      hit: [...target] as [number, number, number],
      adjacent: [target[0], target[1] + 1, target[2]] as [number, number, number],
    },
    expectedSelection: {
      inventoryRevision: inventory.revision,
      modeRevision: player.mode!.revision,
      creativeCatalogRevision: player.creativeCatalog!.revision,
      selectedSlot: player.mode!.value === 'creative' ? player.creativeCatalog!.selectedSlot : player.selectedSlot,
    },
  };
};
const setCreativeShaper = (session: HeadlessSession) => {
  const { server } = session.runtime;
  const target = { kind: 'entity' as const, entityId: session.runtime.playerId };
  expect(
    server.invokeActorModuleOperation(session.runtime.playerId, {
      operationId: 'seedlands:set-mode',
      target,
      input: { mode: 'creative' },
    }),
  ).toMatchObject({ ok: true });
  expect(
    server.invokeActorModuleOperation(session.runtime.playerId, {
      operationId: 'seedlands:set-creative-catalog',
      target,
      input: { slot: 0, itemId: 'sample:soil-shaper' },
    }),
  ).toMatchObject({ ok: true });
};

it('runs Pack-configured soil transform through selected-item Authority in Survival and Creative', async () => {
  const session = await create();
  try {
    await session.world.clock({ kind: 'pause' });
    const { server, playerId } = session.runtime;
    server.giveItem(playerId, { itemId: 'sample:soil-shaper', count: 1, instance: { durability: 5 } });
    expect(server.peekLoadedVoxel(0, 59, 0)?.voxel).toBe(3);
    expect(server.peekLoadedVoxel(0, 60, 0)?.voxel).toBe(0);
    const beforeSurvivalInventory = server.getInventoryPointerView(playerId);
    const beforeSurvivalGameplay = server.gameplayRevision;

    const survival = await session.runtime.performAction(action(session));

    expect(survival.result).toMatchObject({ success: true, handled: true, bindingId: 'sample:soil-shaper-binding' });
    expect(survival.commits).toHaveLength(1);
    expect(server.getVoxel(0, 59, 0)).toBe(4);
    expect(server.getInventory(playerId).slots[0]).toEqual({
      itemId: 'sample:soil-shaper',
      count: 1,
      instance: { durability: 3 },
    });
    expect(server.getInventoryPointerView(playerId).revision).toBe(beforeSurvivalInventory.revision + 1);
    expect(server.gameplayRevision).toBe(beforeSurvivalGameplay + 1);

    server.editBatch({ actorId: 'soil-spine-reset', edits: [{ x: 0, y: 59, z: 0, value: 3 }] });
    setCreativeShaper(session);
    const beforeCreativeInventory = server.getInventoryPointerView(playerId);
    const beforeCreativeGameplay = server.gameplayRevision;
    const beforeCreativeWorld = server.worldRevision;

    const creative = await session.runtime.performAction(action(session));

    expect(creative.result).toMatchObject({ success: true, handled: true, bindingId: 'sample:soil-shaper-binding' });
    expect(creative.commits).toHaveLength(1);
    expect(server.getVoxel(0, 59, 0)).toBe(4);
    expect(server.getInventoryPointerView(playerId)).toEqual(beforeCreativeInventory);
    expect(server.gameplayRevision).toBe(beforeCreativeGameplay + 1);
    expect(server.worldRevision).toBe(beforeCreativeWorld + 1);
  } finally {
    await session.dispose();
  }
});

it('rejects a source voxel outside Pack policy without changing inventory, gameplay, or world', async () => {
  const session = await create();
  try {
    await session.world.clock({ kind: 'pause' });
    const { server, playerId } = session.runtime;
    server.editBatch({ actorId: 'soil-spine-wrong-source', edits: [{ x: 0, y: 59, z: 0, value: 4 }] });
    server.giveItem(playerId, { itemId: 'sample:soil-shaper', count: 1, instance: { durability: 5 } });
    const inventory = server.getInventoryPointerView(playerId);
    const worldRevision = server.worldRevision;
    const gameplayRevision = server.gameplayRevision;
    const response = await session.runtime.performAction(action(session));

    expect(response.result).toMatchObject({ success: false });
    expect(response.commits).toEqual([]);
    expect(server.getVoxel(0, 59, 0)).toBe(4);
    expect(server.getInventoryPointerView(playerId)).toEqual(inventory);
    expect(server.worldRevision).toBe(worldRevision);
    expect(server.gameplayRevision).toBe(gameplayRevision);
  } finally {
    await session.dispose();
  }
});
