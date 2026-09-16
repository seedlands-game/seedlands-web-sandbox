import { describe, expect, it } from 'vitest';
import { entityHitDistance } from '../../../src/client/presentation/entity-hit-volume';

describe('脚底锚点的生物命中体积', () => {
  it('躯干和头部可命中，取模型前表面距离', () => {
    expect(entityHitDistance([0, 0, -2], 'night-stalker', [0, 0.9, 0], [0, 0, -1], 3)).toBeCloseTo(1.35);
    expect(entityHitDistance([0, 0, -2], 'night-stalker', [0, 1.8, 0], [0, 0, -1], 3)).not.toBeNull();
  });
  it('旁边、背后、脚底下、体素遮挡及距离外均不命中', () => {
    expect(entityHitDistance([0, 0, -2], 'night-stalker', [0.8, 0.9, 0], [0, 0, -1], 3)).toBeNull();
    expect(entityHitDistance([0, 0, 2], 'night-stalker', [0, 0.9, 0], [0, 0, -1], 3)).toBeNull();
    expect(entityHitDistance([0, 0, -2], 'night-stalker', [0, -0.2, 0], [0, 0, -1], 3)).toBeNull();
    expect(entityHitDistance([0, 0, -2], 'night-stalker', [0, 0.9, 0], [0, 0, -1], 1)).toBeNull();
    expect(entityHitDistance([0, 0, -5], 'night-stalker', [0, 0.9, 0], [0, 0, -1], 3)).toBeNull();
  });
});
