import { expect, it } from 'vitest';
import { fluidReaction } from '../../src/server/fluid/fluid-reaction';
import { Voxel } from '../../src/world/voxel';

it('水接触熔岩源生成黑曜石且输入顺序无关', () => {
  const source = { voxel: Voxel.Lava, fluid: 0x88 };
  const water = { voxel: Voxel.Water, fluid: 0x88 };
  expect(fluidReaction([1, 2, 3], source, water)).toEqual({ position: [1, 2, 3], voxel: Voxel.Obsidian, fluid: 0 });
  expect(fluidReaction([1, 2, 3], water, source)).toEqual(fluidReaction([1, 2, 3], source, water));
});

it('水接触流动熔岩生成圆石，非异种流体不反应', () => {
  expect(fluidReaction([0, 0, 0], { voxel: Voxel.Lava, fluid: 4 }, { voxel: Voxel.Water, fluid: 7 })).toEqual({
    position: [0, 0, 0],
    voxel: Voxel.Cobblestone,
    fluid: 0,
  });
  expect(fluidReaction([0, 0, 0], { voxel: Voxel.Water, fluid: 8 }, { voxel: Voxel.Water, fluid: 7 })).toBeNull();
});
