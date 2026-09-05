import { describe, expect, it } from 'vitest';
import { SnapshotInterpolator } from '../../src/client/snapshot-interpolator';

describe('SnapshotInterpolator', () => {
  it('按快照活跃时间插值其他实体', () => {
    const interpolator = new SnapshotInterpolator({ interpolationDelayMs: 100, maxExtrapolationMs: 50 });
    interpolator.push({
      epoch: 'world:1',
      physicsTick: 10,
      integratedPhysicsTimeMs: 100,
      activeTimeMs: 500,
      position: { x: 0, y: 2, z: 0 },
    });
    interpolator.push({
      epoch: 'world:1',
      physicsTick: 20,
      integratedPhysicsTimeMs: 200,
      activeTimeMs: 800,
      position: { x: 10, y: 2, z: 0 },
    });

    expect(interpolator.sample('world:1', 250).position).toEqual({ x: 5, y: 2, z: 0 });
  });

  it('丢弃乱序重复和旧 epoch 快照', () => {
    const interpolator = new SnapshotInterpolator({ interpolationDelayMs: 0, maxExtrapolationMs: 50 });

    expect(
      interpolator.push({
        epoch: 'world:2',
        physicsTick: 2,
        integratedPhysicsTimeMs: 20,
        activeTimeMs: 20,
        position: { x: 2, y: 0, z: 0 },
      }),
    ).toBe(true);
    expect(
      interpolator.push({
        epoch: 'world:2',
        physicsTick: 2,
        integratedPhysicsTimeMs: 20,
        activeTimeMs: 20,
        position: { x: 3, y: 0, z: 0 },
      }),
    ).toBe(false);
    expect(
      interpolator.push({
        epoch: 'world:1',
        physicsTick: 3,
        integratedPhysicsTimeMs: 30,
        activeTimeMs: 30,
        position: { x: 3, y: 0, z: 0 },
      }),
    ).toBe(false);
  });

  it('有限外推后停止在最后可信状态', () => {
    const interpolator = new SnapshotInterpolator({ interpolationDelayMs: 0, maxExtrapolationMs: 50 });
    interpolator.push({
      epoch: 'world:1',
      physicsTick: 1,
      integratedPhysicsTimeMs: 0,
      activeTimeMs: 0,
      position: { x: 0, y: 0, z: 0 },
    });
    interpolator.push({
      epoch: 'world:1',
      physicsTick: 2,
      integratedPhysicsTimeMs: 100,
      activeTimeMs: 400,
      position: { x: 10, y: 0, z: 0 },
    });

    expect(interpolator.sample('world:1', 125)).toMatchObject({
      position: { x: 12.5, y: 0, z: 0 },
      mode: 'extrapolated',
    });
    expect(interpolator.sample('world:1', 500)).toMatchObject({ position: { x: 10, y: 0, z: 0 }, mode: 'held' });
  });
});
