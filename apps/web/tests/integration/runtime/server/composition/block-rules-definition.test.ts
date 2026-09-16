import { describe, expect, it } from 'vitest';
import { defineBlockRulesModule } from '../../../../../../../packages/stdlib/src/server/gameplay/modules/block-rules-module';
import type { VoxelGameplayDefinition } from '../../../../../../../packages/stdlib/src/server/gameplay/voxel-gameplay';

const definition = {
  voxel: 2,
  hardnessSeconds: 2.4,
  preferredTool: 'pickaxe',
  drop: { itemId: 'stone-block', count: 1 },
  replaceable: false,
};

describe('Block Rules construction contract', () => {
  it.each([
    { voxel: 65536 },
    { voxel: -1 },
    { voxel: 1.5 },
    { hardnessSeconds: -1 },
    { hardnessSeconds: 0 },
    { hardnessSeconds: 1e-8 },
    { hardnessSeconds: Infinity },
    { hardnessSeconds: 1e6 + 1 },
    { preferredTool: 'hammer' },
    { minimumTier: -1 },
    { minimumTier: 1.5 },
    { minimumTier: Infinity },
    { minimumTier: 1, preferredTool: null },
    { replaceable: 1 },
    { drop: { itemId: '', count: 1 } },
    { drop: { itemId: 'stone-block', count: 0 } },
    { drop: { itemId: 'stone-block', count: 1, instance: { durability: -1 } } },
  ])('rejects malformed definitions immediately: %j', (override) => {
    expect(() =>
      defineBlockRulesModule({
        moduleId: 'test:rules',
        voxelDefinitions: [{ ...definition, ...override } as VoxelGameplayDefinition],
      }),
    ).toThrow();
  });
});
