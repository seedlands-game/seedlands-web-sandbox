import { describe, expect, it } from 'vitest';
import {
  bodyWorldAabb,
  recoverBody,
  separateBodies,
  stepBody,
  type BodyConfig,
  type BodyState,
  type Collider,
  type PhysicsWorld,
} from '../../src/physics';

const body: BodyConfig = {
  localAabb: { min: { x: -0.3, y: 0, z: -0.3 }, max: { x: 0.3, y: 1.8, z: 0.3 } },
  gravity: 18,
  terminalVelocity: 80,
  maxHorizontalSpeed: 6,
  groundAcceleration: 80,
  airAcceleration: 30,
  jumpSpeed: 7,
};

const itemBody: BodyConfig = {
  ...body,
  localAabb: { min: { x: -0.2, y: -0.2, z: -0.2 }, max: { x: 0.2, y: 0.2, z: 0.2 } },
  collisionLayer: 2,
  collisionMask: 1,
  pushable: false,
};

const state = (x: number, y: number, z: number, velocity: Partial<BodyState['velocity']> = {}): BodyState => ({
  position: { x, y, z },
  velocity: { x: velocity.x ?? 0, y: velocity.y ?? 0, z: velocity.z ?? 0 },
});

const box = (
  id: string,
  min: [number, number, number],
  max: [number, number, number],
  extras: Partial<Collider> = {},
): Collider => ({
  id,
  aabb: { min: { x: min[0], y: min[1], z: min[2] }, max: { x: max[0], y: max[1], z: max[2] } },
  ...extras,
});

const world = (colliders: readonly Collider[], fluids: PhysicsWorld['sampleFluid'] = undefined): PhysicsWorld => ({
  querySolids: () => colliders,
  ...(fluids ? { sampleFluid: fluids } : {}),
});

const idle = { wish: { x: 0, z: 0 }, jumpPressed: false, verticalIntent: 0 as const };

describe('统一 swept-AABB 物理核心', () => {
  it('高速下落经过薄平台仍接触，且全底面边缘支撑不依赖中心格', () => {
    const platform = box('thin-platform', [0, 0, 0], [1, 0.12, 1]);
    const result = stepBody({
      state: state(0.85, 8, 0.5, { y: -80 }),
      config: body,
      input: idle,
      world: world([platform]),
      dt: 0.2,
    });
    expect(result.state.position.y).toBeCloseTo(0.12, 5);
    expect(result.grounded).toBe(true);
    expect(result.contacts.some((contact) => contact.normal.y === 1)).toBe(true);
  });

  it('低顶阻挡跳跃，不能穿过顶部碰撞箱', () => {
    const floor = box('floor', [-2, -1, -2], [2, 0, 2]);
    const ceiling = box('ceiling', [-2, 1.9, -2], [2, 2.2, 2]);
    let current = state(0, 0, 0);
    current = stepBody({
      state: current,
      config: body,
      input: { ...idle, jumpPressed: true },
      world: world([floor, ceiling]),
      dt: 1 / 60,
    }).state;
    for (let index = 0; index < 60; index += 1)
      current = stepBody({
        state: current,
        config: body,
        input: idle,
        world: world([floor, ceiling]),
        dt: 1 / 60,
      }).state;
    expect(bodyWorldAabb(current, body).max.y).toBeLessThanOrEqual(1.9 + 1e-5);
    expect(current.velocity.y).toBeLessThanOrEqual(0);
  });

  it('在墙角按稳定顺序滑动，不会穿墙或得到非有限数值', () => {
    const xWall = box('x-wall', [1, -1, -2], [1.2, 3, 2]);
    const zWall = box('z-wall', [-2, -1, 1], [2, 3, 1.2]);
    const result = stepBody({
      state: state(0, 0.5, 0, { x: 10, z: 10 }),
      config: { ...body, gravity: 0 },
      input: idle,
      world: world([zWall, xWall]),
      dt: 0.2,
    });
    const bounds = bodyWorldAabb(result.state, body);
    expect(bounds.max.x).toBeLessThanOrEqual(1 + 1e-5);
    expect(bounds.max.z).toBeLessThanOrEqual(1 + 1e-5);
    expect(Object.values(result.state.velocity).every(Number.isFinite)).toBe(true);
  });

  it('灯笼复合子碰撞箱参与扫掠，未命中子箱的路径可通过', () => {
    const lanternParts = [
      box('lantern-left', [1.25, 0, 0.25], [1.32, 0.94, 0.75]),
      box('lantern-right', [1.68, 0, 0.25], [1.75, 0.94, 0.75]),
    ];
    const blocked = stepBody({
      state: state(0, 0, 0.5, { x: 10 }),
      config: { ...body, gravity: 0 },
      input: idle,
      world: world(lanternParts),
      dt: 0.2,
    });
    const clear = stepBody({
      state: state(0, 0, -0.5, { x: 10 }),
      config: { ...body, gravity: 0 },
      input: { wish: { x: 1, z: 0 }, jumpPressed: false, verticalIntent: 0 },
      world: world(lanternParts),
      dt: 0.2,
    });
    expect(blocked.state.position.x).toBeLessThan(1);
    expect(clear.state.position.x).toBeGreaterThan(1.1);
  });

  it('没有自动一格上升；只有按下跳跃且完整轨迹有净空才可登岸', () => {
    const floor = box('floor', [-2, -1, -2], [4, 0, 2]);
    const shore = box('shore', [0.7, 0, -1], [3, 1, 1]);
    const noJump = stepBody({
      state: state(0, 0, 0, { x: 5 }),
      config: { ...body, gravity: 0 },
      input: idle,
      world: world([floor, shore]),
      dt: 0.3,
    });
    expect(noJump.state.position.y).toBeCloseTo(0, 5);
    expect(noJump.state.position.x).toBeLessThanOrEqual(0.4 + 1e-5);

    let current = state(0, 0, 0, { x: 5 });
    for (let index = 0; index < 36; index += 1)
      current = stepBody({
        state: current,
        config: body,
        input: { wish: { x: 1, z: 0 }, jumpPressed: index === 0, verticalIntent: 0 },
        world: world([floor, shore]),
        dt: 1 / 60,
      }).state;
    expect(current.position.x).toBeGreaterThan(0.7);
    expect(current.position.y).toBeGreaterThanOrEqual(1 - 1e-4);
  });

  it('以实际 AABB 重叠计算浸没、浮力、阻力和流速，物品可用同一内核', () => {
    const fluid = box('water', [-1, -1, -1], [1, 1, 1]);
    const result = stepBody({
      state: state(0, 0, 0, { x: 0, y: -1 }),
      config: { ...itemBody, gravity: 18, buoyancy: 1.5, fluidDrag: 8 },
      input: idle,
      world: world([], () => [{ aabb: fluid.aabb, velocity: { x: 3, y: 0, z: 0 } }]),
      dt: 0.1,
    });
    expect(result.medium.submersion).toBeCloseTo(1, 5);
    expect(result.medium.flow.x).toBeCloseTo(3, 5);
    expect(result.state.velocity.x).toBeGreaterThan(0);
    expect(result.state.velocity.y).toBeGreaterThan(-1);
  });

  it('遵守 body/collider 掩码，传感器报告重叠而不阻挡', () => {
    const ignored = box('ignored', [0.5, -1, -1], [1, 2, 1], { layer: 4, mask: 4 });
    const sensor = box('pickup', [0.5, -1, -1], [1.5, 2, 1], { layer: 1, mask: 2, sensor: true });
    const result = stepBody({
      state: state(0, 0, 0, { x: 5 }),
      config: itemBody,
      input: { wish: { x: 1, z: 0 }, jumpPressed: false, verticalIntent: 0 },
      world: world([ignored, sensor]),
      dt: 0.2,
    });
    expect(result.state.position.x).toBeGreaterThan(0.5);
    expect(result.sensors.map((contact) => contact.colliderId)).toEqual(['pickup']);
  });

  it('显式、有界地恢复初始化重叠；普通步不会暗中传送恢复', () => {
    const solid = box('solid', [0, 0, 0], [1, 1, 1]);
    const embedded = state(0.5, 0.2, 0.5);
    const ordinary = stepBody({
      state: embedded,
      config: { ...body, gravity: 0 },
      input: idle,
      world: world([solid]),
      dt: 1 / 60,
    });
    expect(ordinary.state.position).toEqual(embedded.position);
    const recovered = recoverBody({
      state: embedded,
      config: { ...body, gravity: 0 },
      world: world([solid]),
      maxDistance: 1,
    });
    expect(recovered.recovered).toBe(true);
    expect(recovered.distance).toBeLessThanOrEqual(1);
    expect(recoverBody({ state: embedded, config: body, world: world([solid]), maxDistance: 0.01 }).recovered).toBe(
      false,
    );
  });

  it('有限推离只处理角色身体，掉落物可经掩码选择重叠', () => {
    const left = state(0, 0, 0);
    const right = state(0.2, 0, 0);
    const separated = separateBodies({ left, leftConfig: body, right, rightConfig: body, maxDistance: 0.1 });
    expect(separated.separated).toBe(true);
    expect(separated.left.position.x).toBeLessThan(0);
    expect(separated.right.position.x).toBeGreaterThan(0.2);
    expect(
      separateBodies({ left, leftConfig: itemBody, right, rightConfig: itemBody, maxDistance: 0.1 }).separated,
    ).toBe(false);
  });

  it('拒绝非有限姿态和无效 dt，避免传播 NaN', () => {
    expect(() => stepBody({ state: state(0, 0, 0), config: body, input: idle, world: world([]), dt: 0 })).toThrow(
      RangeError,
    );
    expect(() =>
      stepBody({ state: state(Number.NaN, 0, 0), config: body, input: idle, world: world([]), dt: 1 / 60 }),
    ).toThrow(RangeError);
  });
});
