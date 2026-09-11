import { describe, expect, it } from 'vitest';
import { GroundNavigator } from '../../src/server/simulation/ground-navigator';
import { createCharacterNavigationConstraint } from '../../src/server/simulation/character-navigation';
import { Voxel } from '../../src/world/voxel';
import type { PerceptionSnapshot } from '../../src/server/simulation/perception-runtime';

const flatWorld = (blocked = new Set<string>()) =>
  new GroundNavigator((x, y, z) => (y <= 0 || blocked.has(`${x},${y},${z}`) ? Voxel.Stone : Voxel.Air));

const perception = (observerId: string, visibleEntityIds: readonly string[]): PerceptionSnapshot => ({
  observerId,
  visibleEntities: visibleEntityIds.map((entityId, index) => ({ entityId, type: 'npc', distance: index + 1 })),
  threats: [],
  food: [],
  pois: [],
  observations: [],
  candidateCount: visibleEntityIds.length,
  lineOfSightChecks: visibleEntityIds.length,
});

const settler = (id: string, position: [number, number, number]) => ({
  id,
  type: 'npc' as const,
  archetype: 'settler' as const,
  position,
});

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

  it('routes the current body volume and path edges around locally visible character bodies', () => {
    const entities = new Map([
      ['mover', settler('mover', [0.5, 1, 0.5])],
      ['blocker-a', settler('blocker-a', [1.8, 1, 0.5])],
      ['blocker-b', settler('blocker-b', [2.5, 1, 1.5])],
    ]);
    const constraint = createCharacterNavigationConstraint({
      actorId: 'mover',
      target: [4.5, 1, 0.5],
      perception: perception('mover', ['blocker-a', 'blocker-b']),
      resolveEntity: (entityId) => entities.get(entityId) ?? null,
    });
    const result = flatWorld().plan([0.5, 1, 0.5], [4.5, 1, 0.5], { maxExpanded: 128, constraint });
    expect(result.status).toBe('reached');
    if (result.status !== 'reached') return;
    expect(result.path.some((position) => position[2] < -0.5)).toBe(true);
    expect(constraint.blocksEdge([0.5, 1, 0.5], [2.5, 1, 0.5])).toBe(true);
  });

  it('keeps a visible target body approachable and rebuilds constraints from current local perception', () => {
    const entities = new Map([
      ['mover', settler('mover', [0.5, 1, 0.5])],
      ['target', settler('target', [3.5, 1, 0.5])],
      ['moved', settler('moved', [1.8, 1, 0.5])],
      ['unseen', settler('unseen', [2.5, 1, 0.5])],
    ]);
    const options = (visibleEntityIds: readonly string[]) =>
      createCharacterNavigationConstraint({
        actorId: 'mover',
        target: [3.5, 1, 0.5],
        perception: perception('mover', visibleEntityIds),
        resolveEntity: (entityId) => entities.get(entityId) ?? null,
      });
    const direct = flatWorld().plan([0.5, 1, 0.5], [3.5, 1, 0.5], {
      maxExpanded: 64,
      constraint: options(['target']),
    });
    expect(direct).toMatchObject({ status: 'reached' });
    if (direct.status === 'reached') expect(direct.path.every((position) => position[2] === 0.5)).toBe(true);

    const around = flatWorld().plan([0.5, 1, 0.5], [3.5, 1, 0.5], {
      maxExpanded: 128,
      constraint: options(['moved']),
    });
    expect(around).toMatchObject({ status: 'reached' });
    if (around.status === 'reached') expect(around.path.some((position) => position[2] !== 0.5)).toBe(true);

    entities.set('moved', settler('moved', [20.5, 1, 20.5]));
    const afterMove = flatWorld().plan([0.5, 1, 0.5], [3.5, 1, 0.5], {
      maxExpanded: 64,
      constraint: options(['moved']),
    });
    expect(afterMove).toMatchObject({ status: 'reached' });
    if (afterMove.status === 'reached') expect(afterMove.path.every((position) => position[2] === 0.5)).toBe(true);

    const unseen = flatWorld().plan([0.5, 1, 0.5], [3.5, 1, 0.5], {
      maxExpanded: 64,
      constraint: options([]),
    });
    expect(unseen).toMatchObject({ status: 'reached' });
    if (unseen.status === 'reached') expect(unseen.path.every((position) => position[2] === 0.5)).toBe(true);
  });

  it('allows a bounded escape from initial body penetration without opening an edge through the body', () => {
    const entities = new Map([
      ['mover', settler('mover', [0.5, 1, 0.5])],
      ['contact', settler('contact', [1.79, 1, 0.5])],
    ]);
    const constraint = createCharacterNavigationConstraint({
      actorId: 'mover',
      target: [-2.5, 1, 0.5],
      perception: perception('mover', ['contact']),
      resolveEntity: (entityId) => entities.get(entityId) ?? null,
    });

    expect(constraint.blocksNode([0.5, 1, 0.5])).toBe(true);
    expect(constraint.blocksEdge([0.5, 1, 0.5], [-0.5, 1, 0.5])).toBe(false);
    expect(constraint.blocksEdge([0.5, 1, 0.5], [1.5, 1, 0.5])).toBe(true);
    expect(flatWorld().plan([0.5, 1, 0.5], [-2.5, 1, 0.5], { maxExpanded: 64, constraint })).toMatchObject({
      status: 'reached',
    });
  });

  it('escapes deep initial penetration over decreasing steps and cannot deepen or re-enter it', () => {
    const entities = new Map([
      ['mover', settler('mover', [0.5, 1, 0.5])],
      ['contact', settler('contact', [0.349999, 1, 0.650001])],
      ['opposite-contact', settler('opposite-contact', [1.2, 1, 0.5])],
    ]);
    const constraint = createCharacterNavigationConstraint({
      actorId: 'mover',
      target: [3.5, 1, 0.5],
      perception: perception('mover', ['contact']),
      resolveEntity: (entityId) => entities.get(entityId) ?? null,
    });

    expect(constraint.blocksNode([0.5, 1, 0.5])).toBe(true);
    expect(constraint.blocksNode([1.5, 1, 0.5])).toBe(true);
    expect(constraint.allowsBlockedNodeTransition?.([0.5, 1, 0.5], [1.5, 1, 0.5])).toBe(true);
    expect(constraint.blocksEdge([0.5, 1, 0.5], [1.5, 1, 0.5])).toBe(false);
    expect(constraint.blocksEdge([0.5, 1, 0.5], [-0.5, 1, 0.5])).toBe(true);
    expect(constraint.blocksEdge([1.5, 1, 0.5], [0.5, 1, 0.5])).toBe(true);
    expect(constraint.blocksEdge([2.5, 1, 0.5], [1.5, 1, 0.5])).toBe(true);
    expect(flatWorld().plan([0.5, 1, 0.5], [3.5, 1, 0.5], { maxExpanded: 64, constraint })).toMatchObject({
      status: 'reached',
    });

    const squeezed = createCharacterNavigationConstraint({
      actorId: 'mover',
      target: [3.5, 1, 0.5],
      perception: perception('mover', ['contact', 'opposite-contact']),
      resolveEntity: (entityId) => entities.get(entityId) ?? null,
    });
    expect(squeezed.allowsBlockedNodeTransition?.([0.5, 1, 0.5], [1.5, 1, 0.5])).toBe(false);
    expect(squeezed.blocksEdge([0.5, 1, 0.5], [1.5, 1, 0.5])).toBe(true);
  });
});
