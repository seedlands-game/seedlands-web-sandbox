import { expect, it } from 'vitest';
import { assembleProductPacks, type VerifiedPackArtifact } from '@seedlands/stdlib/host';
import { definePack, defineCropInteractionModule, defineItemInteractionModule } from '@seedlands/stdlib/mod-api';
import { HeadlessSession } from '../../../../../../../packages/stdlib/src/server/headless/headless-session';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { buildingModules } from '../../../../fixtures/packs/builder/building-content';

const pack = definePack({
  id: 'sample:crop-plant',
  version: '1.0.0',
  kind: 'playbook',
  modules: [
    ...buildingModules(false),
    defineCropInteractionModule({
      moduleId: 'sample:crops',
      plantOperationId: 'sample:plant',
      seedItemId: 'sample:wood',
      soilVoxels: [3],
      emptyAboveVoxels: [0],
      waterVoxels: [4],
      matureDrops: [{ itemId: 'sample:stone', count: 2 }],
      immatureDrops: [{ itemId: 'sample:wood', count: 1 }],
    }),
    defineItemInteractionModule({
      moduleId: 'sample:crop-bindings',
      permissions: [{ resource: 'seedlands.block-voxel', operations: ['execute'] }],
      definitions: [
        {
          id: 'sample:seed-binding',
          selector: { itemId: 'sample:wood' },
          trigger: 'voxel',
          operationId: 'sample:plant',
          presentationKey: 'sample:seed',
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

it('plants with a non-Classic Pack through the same selected-item Authority and sole crop owner', async () => {
  const session = await HeadlessSession.create({
    seedText: 'crop-plant-spine',
    platform: testCorePlatform,
    createComposition: () => assembleProductPacks([verified], { approvedPlaybook }),
  });
  try {
    await session.world.clock({ kind: 'pause' });
    const { server, playerId } = session.runtime;
    server.giveItem(playerId, { itemId: 'sample:wood', count: 2 });
    const player = server.getPlayerState(playerId),
      inventory = server.getInventoryPointerView(playerId),
      worldRevision = server.worldRevision,
      gameplayRevision = server.gameplayRevision;
    const action = {
      type: 'interact' as const,
      intent: 'use' as const,
      target: {
        kind: 'voxel' as const,
        hit: [0, 59, 0] as [number, number, number],
        adjacent: [0, 60, 0] as [number, number, number],
      },
      expectedSelection: {
        inventoryRevision: inventory.revision,
        modeRevision: player.mode!.revision,
        creativeCatalogRevision: player.creativeCatalog!.revision,
        selectedSlot: player.selectedSlot,
      },
    };
    const response = await session.runtime.performAction(action);
    expect(response.result).toMatchObject({ success: true, handled: true, bindingId: 'sample:seed-binding' });
    expect(response.commits).toEqual([]);
    expect(server.getInventoryPointerView(playerId).slots[0]).toEqual({ itemId: 'sample:wood', count: 1 });
    expect(server.getInventoryPointerView(playerId).revision).toBe(inventory.revision + 1);
    expect(server.gameplayRevision).toBe(gameplayRevision + 1);
    expect(server.worldRevision).toBe(worldRevision);
    expect(server.crops.list()).toEqual([{ position: [0, 59, 0], stage: 0, subSeconds: 0 }]);
    expect(server.getVoxel(0, 59, 0)).toBe(3);
    const current = server.getInventoryPointerView(playerId);
    const repeated = await session.runtime.performAction({
      ...action,
      expectedSelection: { ...action.expectedSelection, inventoryRevision: current.revision },
    });
    expect(repeated.result).toMatchObject({ success: false });
    expect(server.getInventoryPointerView(playerId)).toEqual(current);
    expect(server.crops.list()).toHaveLength(1);
    expect(server.worldRevision).toBe(worldRevision);
  } finally {
    await session.dispose();
  }
});
