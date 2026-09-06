import { describe, expect, it } from 'vitest';
import { GroundNavigator } from '../../src/server/simulation/ground-navigator';
import { Voxel } from '../../src/world/voxel';

const flatWorld = (blocked = new Set<string>()) =>
  new GroundNavigator((x, y, z) => (y <= 0 || blocked.has(`${x},${y},${z}`) ? Voxel.Stone : Voxel.Air));

describe('voxel ground navigation', () => {
  it('walks flat ground, crosses Chunk boundaries and returns adjacent legal nodes', () => {
    const result = flatWorld().plan([30.5, 1, 0.5], [34.5, 1, 0.5], { maxExpanded: 64 });
    expect(result.status).toBe('reached');
    if (result.status !== 'reached') return;
    expect(result.path.at(0)).toEqual([30.5, 1, 0.5]);
    expect(result.path.at(-1)).toEqual([34.5, 1, 0.5]);
    for (let index = 1; index < result.path.length; index += 1) {
      const previous = result.path[index - 1];
      const current = result.path[index];
      expect(Math.abs(current[0] - previous[0]) + Math.abs(current[2] - previous[2])).toBe(1);
      expect(Math.abs(current[1] - previous[1])).toBeLessThanOrEqual(1);
    }
  });

  it('steps up and down one voxel and routes around solid obstacles', () => {
    const blocked = new Set(['1,1,0']);
    const navigator = flatWorld(blocked);
    const around = navigator.plan([0.5, 1, 0.5], [3.5, 1, 0.5], { maxExpanded: 128 });
    expect(around.status).toBe('reached');
    if (around.status === 'reached') expect(around.path).not.toContainEqual([1.5, 1, 0.5]);

    const stepped = new GroundNavigator((x, y, z) => {
      if (y <= 0) return Voxel.Stone;
      if (x === 1 && z === 0 && y === 1) return Voxel.Stone;
      return Voxel.Air;
    }).plan([0.5, 1, 0.5], [1.5, 2, 0.5], { maxExpanded: 32 });
    expect(stepped).toMatchObject({ status: 'reached' });
  });

  it('distinguishes unreachable targets from an exhausted search budget', () => {
    const enclosed = new Set(
      [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ].flatMap(([x, z]) => [`${x},1,${z}`, `${x},2,${z}`]),
    );
    expect(flatWorld(enclosed).plan([0.5, 1, 0.5], [4.5, 1, 0.5], { maxExpanded: 128 })).toMatchObject({
      status: 'unreachable',
    });
    expect(flatWorld().plan([0.5, 1, 0.5], [40.5, 1, 0.5], { maxExpanded: 2 })).toMatchObject({
      status: 'budget-exhausted',
      expandedNodes: 2,
    });
  });

  it('reports when a previously planned next node becomes blocked', () => {
    const blocked = new Set<string>();
    const navigator = flatWorld(blocked);
    const result = navigator.plan([0.5, 1, 0.5], [3.5, 1, 0.5], { maxExpanded: 64 });
    expect(result.status).toBe('reached');
    if (result.status !== 'reached') return;
    blocked.add('1,1,0');
    expect(navigator.isPathStepValid(result.path[1])).toBe(false);
  });
});
