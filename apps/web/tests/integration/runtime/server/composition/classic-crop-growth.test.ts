import { expect, it } from 'vitest';
import { classicContent, getItemDefinition } from '../../../../fixtures/classic/content';
import { Voxel } from '../../../../../../../packages/stdlib/src/world/voxel';
import {
  plantCrop,
  advanceCrop,
  harvestCrop,
  CROP_MATURE_STAGE,
} from '../../../../../../../packages/stdlib/src/server/gameplay/modules/crop-growth-policy';

it('小麦种子由小麦获得并只能种在耕地上，非耕地拒绝', () => {
  const seeds = getItemDefinition('wheat-seeds');
  expect(seeds.itemType).toBe('resource');
  // 种子来自破坏草或收割，注册为内容
  expect(classicContent.items.has('wheat-seeds')).toBe(true);

  const planted = plantCrop(Voxel.Farmland);
  expect(planted).toEqual({ stage: 0 });
  expect(() => plantCrop(Voxel.Dirt)).toThrow();
  expect(() => plantCrop(Voxel.Grass)).toThrow();
});

it('作物按固定间隔分阶段生长，封顶在成熟阶段且确定性一致', () => {
  const perStage = 30;
  let state = plantCrop(Voxel.Farmland);
  // 未满一阶段不推进
  state = advanceCrop(state, 20, perStage);
  expect(state.stage).toBe(0);
  // 累计满两阶段推进两级
  state = advanceCrop(state, 40, perStage);
  expect(state.stage).toBe(2);
  // 大步长封顶在成熟阶段
  const matured = advanceCrop({ stage: 0 }, perStage * 100, perStage);
  expect(matured.stage).toBe(CROP_MATURE_STAGE);
  // 已成熟不再推进
  expect(advanceCrop({ stage: CROP_MATURE_STAGE }, perStage * 5, perStage).stage).toBe(CROP_MATURE_STAGE);
});

it('成熟收割产出小麦与种子，未成熟只回收种子', () => {
  const mature = harvestCrop({ stage: CROP_MATURE_STAGE });
  expect(mature.drops).toEqual([
    { itemId: 'wheat', count: 1 },
    { itemId: 'wheat-seeds', count: 1 },
  ]);
  const immature = harvestCrop({ stage: 3 });
  expect(immature.drops).toEqual([{ itemId: 'wheat-seeds', count: 1 }]);
  // 非法阶段拒绝
  expect(() => harvestCrop({ stage: -1 })).toThrow();
  expect(() => harvestCrop({ stage: CROP_MATURE_STAGE + 1 })).toThrow();
});
