import { describe, expect, it } from 'vitest';
import {
  LIGHTING_QUALITY_BUDGETS,
  localShadowNeedsUpdate,
  reconcileLocalLightSlots,
  selectNearestLanterns,
} from '../../src/app/scene/advanced-lighting-budget';

describe('高级光影预算', () => {
  it('为每个画质档位提供严格递增且有界的 GPU 预算', () => {
    expect(LIGHTING_QUALITY_BUDGETS.low).toMatchObject({
      sunShadowResolution: 0,
      maxLocalLights: 2,
      maxShadowedLocalLights: 0,
      reflectionResolution: 0,
      reflectionFrameInterval: 0,
      postProcessing: false,
    });
    expect(LIGHTING_QUALITY_BUDGETS.medium).toMatchObject({
      sunShadowResolution: 512,
      maxLocalLights: 4,
      maxShadowedLocalLights: 1,
      reflectionResolution: 128,
      reflectionFrameInterval: 8,
      postProcessing: true,
    });
    expect(LIGHTING_QUALITY_BUDGETS.high).toMatchObject({
      sunShadowResolution: 1024,
      maxLocalLights: 6,
      maxShadowedLocalLights: 2,
      reflectionResolution: 256,
      reflectionFrameInterval: 4,
      postProcessing: true,
    });
  });

  it('只选择扫描半径内最近的有限灯笼并保持稳定次序', () => {
    const selected = selectNearestLanterns(
      [0, 10, 0],
      [
        [4, 10, 0],
        [1, 10, 0],
        [0, 30, 0],
        [-1, 10, 0],
        [2, 10, 0],
      ],
      { horizontalRadius: 5, verticalRadius: 3, limit: 3 },
    );
    expect(selected).toEqual([
      [-1, 10, 0],
      [1, 10, 0],
      [2, 10, 0],
    ]);
  });

  it('候选距离次序变化时保留已有灯槽，且仅场景变化触发阴影更新', () => {
    const first = reconcileLocalLightSlots(
      [],
      [
        [-1, 10, 0],
        [1, 10, 0],
      ],
      2,
    );
    const second = reconcileLocalLightSlots(
      first,
      [
        [1, 10, 0],
        [-1, 10, 0],
      ],
      2,
    );
    expect(second).toEqual(first);
    expect(localShadowNeedsUpdate({ previousWorldRevision: 4, worldRevision: 4, slotsChanged: false })).toBe(false);
    expect(localShadowNeedsUpdate({ previousWorldRevision: 4, worldRevision: 5, slotsChanged: false })).toBe(true);
    expect(localShadowNeedsUpdate({ previousWorldRevision: 5, worldRevision: 5, slotsChanged: true })).toBe(true);
  });
});
