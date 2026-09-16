import { describe, expect, it } from 'vitest';
import { SnapshotInterpolator } from '../../../src/client/snapshot-interpolator';

describe('SnapshotInterpolator', () => {
  it('按快照已积分物理时间插值其他实体', () => {
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

  it('有限外推后停在外推边界，不突然弹回旧快照位置', () => {
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
    expect(interpolator.sample('world:1', 500)).toMatchObject({ position: { x: 15, y: 0, z: 0 }, mode: 'held' });
  });
  it('非有限或物理时间倒退的快照不污染历史，输入输出均隔离', () => {
    const interpolation = new SnapshotInterpolator({ interpolationDelayMs: 0, maxExtrapolationMs: 50 });
    const position = { x: 1, y: 0, z: 0 };
    const snapshot = { epoch: 'a', physicsTick: 1, integratedPhysicsTimeMs: 10, activeTimeMs: 10, position };
    expect(interpolation.push({ ...snapshot, position: { x: NaN, y: 0, z: 0 } })).toBe(false);
    expect(interpolation.push(snapshot)).toBe(true);
    position.x = 999;
    const sample = interpolation.sample('a', 10);
    expect(sample.position.x).toBe(1);
    Object.assign(sample.position, { x: 555 });
    expect(interpolation.sample('a', 10).position.x).toBe(1);
    expect(interpolation.push({ ...snapshot, physicsTick: 2, integratedPhysicsTimeMs: 9 })).toBe(false);
    expect(() => interpolation.sample('a', NaN)).toThrow();
    expect(() => new SnapshotInterpolator({ interpolationDelayMs: -1, maxExtrapolationMs: 50 })).toThrow();
  });
});
