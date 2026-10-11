import { describe, expect, it } from 'vitest';
import { orientedBox, orientedBoxBounds, sweepOrientedBox } from '../../src/physics/oriented-box';

const carrier = { min: { x: -0.45, y: 0, z: -0.45 }, max: { x: 0.45, y: 0.7, z: 0.45 } };
const block = { min: { x: 3, y: 31, z: 2 }, max: { x: 4, y: 32, z: 3 } };

describe('oriented carrier collision against true world boxes', () => {
  it('keeps the supported ascending carrier above the Stone corner without shrinking its shape', () => {
    const box = orientedBox(carrier, { x: 2.55, y: 31.55, z: 2.5 }, Math.PI / 2, Math.PI / 4);
    expect(sweepOrientedBox(box, block, { x: 0.45, y: 0.45, z: 0 })).toBeNull();
    expect(
      sweepOrientedBox(orientedBox(carrier, { x: 2.55, y: 31.55, z: 2.5 }, Math.PI / 2, 0), block, {
        x: 0.45,
        y: 0.45,
        z: 0,
      }),
    ).not.toBeNull();
    const bounds = orientedBoxBounds(box);
    expect(bounds.max.y - bounds.min.y).toBeCloseTo((0.9 + 0.7) / Math.sqrt(2));
  });

  it('still rejects penetrating support and a wall crossing the actual tilted body', () => {
    const box = orientedBox(carrier, { x: 2.55, y: 31.5, z: 2.5 }, Math.PI / 2, Math.PI / 4);
    expect(sweepOrientedBox(box, block, { x: 0.45, y: 0.45, z: 0 })).not.toBeNull();
    const clear = orientedBox(carrier, { x: 2.55, y: 31.55, z: 2.5 }, Math.PI / 2, Math.PI / 4);
    expect(
      sweepOrientedBox(
        clear,
        { min: { x: 3, y: 31, z: 2 }, max: { x: 4, y: 34, z: 3 } },
        {
          x: 0.45,
          y: 0.45,
          z: 0,
        },
      ),
    ).not.toBeNull();
  });

  it('preserves flat touching support, inward contacts, outward separation and thin obstacles', () => {
    const box = orientedBox(carrier, { x: 0, y: 1, z: 0 }, 0, 0);
    const floor = { min: { x: -2, y: 0, z: -2 }, max: { x: 2, y: 1, z: 2 } };
    expect(sweepOrientedBox(box, floor, { x: 1, y: 0, z: 0 })).toBeNull();
    expect(sweepOrientedBox(box, floor, { x: 0, y: -0.1, z: 0 })).toBeCloseTo(0);
    expect(sweepOrientedBox(box, floor, { x: 0, y: 0.1, z: 0 })).toBeNull();
    expect(
      sweepOrientedBox(
        box,
        { min: { x: 0.9, y: 1, z: -1 }, max: { x: 0.91, y: 2, z: 1 } },
        {
          x: 2,
          y: 0,
          z: 0,
        },
      ),
    ).toBeCloseTo(0.225);
  });

  it('rejects malformed geometry instead of treating it as clear', () => {
    expect(() => orientedBox(carrier, { x: NaN, y: 0, z: 0 }, 0, 0)).toThrow();
    expect(() => orientedBox(carrier, { x: 0, y: 0, z: 0 }, 0, Infinity)).toThrow();
    const box = orientedBox(carrier, { x: 0, y: 0, z: 0 }, 0, 0);
    expect(() => sweepOrientedBox({ ...box, half: [NaN, 1, 1] }, block, { x: 0, y: 0, z: 0 })).toThrow();
    expect(() => orientedBoxBounds({ ...box, axes: [{ x: 2, y: 0, z: 0 }, box.axes[1], box.axes[2]] })).toThrow();
    expect(() => sweepOrientedBox(box, block, { x: Infinity, y: 0, z: 0 })).toThrow();
  });

  it.each([-1, 1] as const)('retains supported slope separation and penetration in direction %s', (direction) => {
    const position = { x: direction * 2.55, y: 31.55, z: 2.5 };
    const support = direction === 1 ? block : { min: { x: -4, y: 31, z: 2 }, max: { x: -3, y: 32, z: 3 } };
    const yaw = (direction * Math.PI) / 2;
    expect(
      sweepOrientedBox(orientedBox(carrier, position, yaw, Math.PI / 4), support, {
        x: direction * 0.45,
        y: 0.45,
        z: 0,
      }),
    ).toBeNull();
    const high = orientedBox(carrier, { x: direction * 3, y: 32, z: 2.5 }, -yaw, -Math.PI / 4);
    expect(sweepOrientedBox(high, support, { x: -direction * 0.45, y: -0.45, z: 0 })).toBeNull();
  });
});
