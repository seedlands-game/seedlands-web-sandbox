import { describe, expect, it } from 'vitest';
import {
  selectReachableBodyTarget,
  type BodyConfig,
  type Collider,
  type PhysicsWorld,
} from '../../packages/game-core/src/physics';

const itemBody: BodyConfig = {
  localAabb: { min: { x: -0.2, y: 0, z: -0.2 }, max: { x: 0.2, y: 0.4, z: 0.2 } },
  collisionLayer: 2,
  collisionMask: 1,
};

const wall: Collider = {
  id: 'wall',
  aabb: { min: { x: 1, y: -1, z: -1 }, max: { x: 2, y: 2, z: 1 } },
};

const world = (colliders: readonly Collider[]): PhysicsWorld => ({ querySolids: () => colliders });
const state = { position: { x: 0.5, y: 0, z: 0 }, velocity: { x: 0, y: 0, z: 0 } };
const targets = [
  { id: 'b-clear', position: { x: -1.5, y: 0, z: 0 } },
  { id: 'a-blocked', position: { x: 2.5, y: 0, z: 0 } },
];

describe('身体目标可达性', () => {
  it('按距离和 id 稳定选择，真实墙体不会遮蔽同范围的清晰路径', () => {
    const selected = selectReachableBodyTarget({
      state,
      config: itemBody,
      world: world([wall]),
      targets: [...targets].reverse(),
      maxDistance: 2.25,
      maxCandidates: 8,
    });
    expect(selected?.id).toBe('b-clear');
  });

  it('只让固定数量的最近候选进入扫掠，并用 id 打破等距顺序', () => {
    expect(
      selectReachableBodyTarget({
        state,
        config: itemBody,
        world: world([]),
        targets,
        maxDistance: 2.25,
        maxCandidates: 1,
      })?.id,
    ).toBe('a-blocked');
  });

  it('游标跨步轮转候选页，让第九个可达目标最终获得固定预算内检查', () => {
    const cursorState = { ...state, position: { x: 0, y: 0, z: 0 } };
    const blocked = Array.from({ length: 8 }, (_, index) => ({
      id: `blocked-${index}`,
      position: { x: 0.8 + index * 0.1, y: 0, z: 0 },
    }));
    const clear = { id: 'clear-ninth', position: { x: -2, y: 0, z: 0 } };
    const narrowWall: Collider = {
      id: 'narrow-wall',
      aabb: { min: { x: 0.4, y: -1, z: -1 }, max: { x: 0.6, y: 2, z: 1 } },
    };
    const options = {
      state: cursorState,
      config: itemBody,
      world: world([narrowWall]),
      targets: [...blocked, clear],
      maxDistance: 2.25,
      maxCandidates: 8,
    };
    expect(selectReachableBodyTarget(options)).toBeNull();
    expect(selectReachableBodyTarget({ ...options, startIndex: 8 })?.id).toBe('clear-ninth');
  });
});
