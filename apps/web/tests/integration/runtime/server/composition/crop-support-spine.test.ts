import { expect, it } from 'vitest';
import { assembleProductPacks, type VerifiedPackArtifact } from '@seedlands/stdlib/host';
import {
  definePack,
  defineBlockActionsModule,
  defineCropInteractionModule,
  defineSoilTransformInteractionModule,
} from '@seedlands/stdlib/mod-api';
import { HeadlessSession } from '../../../../../../../packages/stdlib/src/server/headless/headless-session';
import { testCorePlatform } from '../../../../../../../packages/stdlib/tests/support/core-platform';
import { buildingModules } from '../../../../fixtures/packs/builder/building-content';

it.each([true, false])(
  'keeps the registered soil transform atomic when its result supports crops=%s',
  async (supported) => {
    const pack = definePack({
      id: 'sample:crop-support-spine',
      version: '1.0.0',
      kind: 'playbook',
      modules: [
        ...buildingModules(false).filter((module) => module.descriptor.id !== 'seedlands:block-actions-module'),
        defineBlockActionsModule({ crops: true }),
        {
          descriptor: { id: 'sample:hoe-content', version: '1.0.0' },
          register(api) {
            api.registerItem({
              id: 'sample:hoe',
              storageId: 'sample:hoe',
              name: 'Hoe',
              itemType: 'tool',
              stackLimit: 1,
              durability: { max: 16 },
              capabilities: [{ type: 'till' }],
            });
          },
        },
        defineCropInteractionModule({
          moduleId: 'sample:crops',
          plantOperationId: 'sample:plant',
          soilVoxels: supported ? [3, 4] : [3],
          emptyAboveVoxels: [0],
          waterVoxels: [4],
          seedItemId: 'sample:wood',
          matureDrops: [{ itemId: 'sample:stone', count: 2 }],
          immatureDrops: [{ itemId: 'sample:wood', count: 1 }],
        }),
        defineSoilTransformInteractionModule({
          moduleId: 'sample:soil-change',
          operationId: 'sample:transform',
          sourceVoxels: [3],
          targetVoxel: 4,
          emptyAboveVoxels: [0],
          durabilityCost: 1,
        }),
      ],
    });
    const verified: VerifiedPackArtifact = {
      ...pack,
      integrity: { algorithm: 'sha256', manifestDigest: 'a'.repeat(64), entryDigest: 'b'.repeat(64), resources: [] },
    };
    const session = await HeadlessSession.create({
      seedText: 'crop-support-spine',
      platform: testCorePlatform,
      createComposition: () =>
        assembleProductPacks([verified], {
          approvedPlaybook: {
            id: verified.manifest.id,
            version: verified.manifest.version,
            integrity: verified.integrity,
            permissions: verified.modules.flatMap((module) => module.descriptor.permissions ?? []),
          },
        }),
    });
    try {
      await session.world.clock({ kind: 'pause' });
      const { server, playerId } = session.runtime;
      const hit = [0, 59, 0] as const;
      const target = { kind: 'voxel' as const, position: hit };
      const input = { version: 1, trigger: 'voxel', target: { kind: 'voxel', hit, adjacent: [0, 60, 0] as const } };
      server.giveItem(playerId, { itemId: 'sample:wood', count: 2 });
      const planted = server.invokeActorModuleOperation(playerId, { operationId: 'sample:plant', target, input });
      expect(planted, JSON.stringify(planted)).toMatchObject({ ok: true });
      const crop = server.crops.at(hit);
      expect(crop).toMatchObject({ position: hit, stage: 0 });
      server.giveItem(playerId, { itemId: 'sample:hoe', count: 1, instance: { durability: 16 } });
      await session.runtime.performAction({ type: 'select-hotbar', slot: 1 });
      const worldRevision = server.worldRevision;
      const gameplayRevision = server.gameplayRevision;
      const transformed = server.invokeActorModuleOperation(playerId, {
        operationId: 'sample:transform',
        target,
        input,
      });
      expect(transformed, JSON.stringify(transformed)).toMatchObject({ ok: true });
      expect(server.peekLoadedVoxel(...hit)?.voxel).toBe(4);
      expect(server.crops.at(hit)).toEqual(supported ? crop : null);
      expect(server.getInventoryPointerView(playerId).slots[1]).toMatchObject({
        itemId: 'sample:hoe',
        instance: { durability: 15 },
      });
      expect(server.worldRevision).toBe(worldRevision + 1);
      expect(server.gameplayRevision).toBe(gameplayRevision + 1);
    } finally {
      await session.dispose();
    }
  },
);
