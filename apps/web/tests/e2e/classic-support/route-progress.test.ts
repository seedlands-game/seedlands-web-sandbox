import { describe, expect, it } from 'vitest';
import {
  reachedRouteTarget,
  routeInputSettled,
  routePulseDurationMs,
  routePulseSettledPredicate,
} from './route-progress';
import { bodyConfigFor, stepBody, type BodyState, type PhysicsWorld } from '@seedlands/stdlib/physics';

const floor: PhysicsWorld = {
  querySolids: () => [{ id: 'floor', aabb: { min: { x: -1000, y: -1, z: -1000 }, max: { x: 1000, y: 0, z: 1000 } } }],
};
const corridorTarget = [78.5, -0.5] as const;
const failedPosition = { x: 78.49967344193138, y: 0, z: -0.6361418276453821 };

function pulse(body: BodyState, milliseconds: number, physicsHz: number): BodyState {
  const dx = corridorTarget[0] - body.position.x;
  const dz = corridorTarget[1] - body.position.z;
  const distance = Math.hypot(dx, dz);
  const wish = { x: dx / distance, z: dz / distance };
  for (let tick = 0; tick < Math.round((milliseconds * physicsHz) / 1000); tick++)
    body = stepBody({
      state: body,
      config: bodyConfigFor('player'),
      world: floor,
      dt: 1 / physicsHz,
      input: { wish, jumpPressed: false, verticalIntent: 0 },
    }).state;
  for (let tick = 0; tick < physicsHz && Math.hypot(body.velocity.x, body.velocity.z) > 1e-6; tick++)
    body = stepBody({
      state: body,
      config: bodyConfigFor('player'),
      world: floor,
      dt: 1 / physicsHz,
      input: { wish: { x: 0, z: 0 }, jumpPressed: false, verticalIntent: 0 },
    }).state;
  return body;
}

describe('Classic real-input route progress', () => {
  it('requires a fresh neutral native release in the same epoch and its consumed sequence', () => {
    const before = {
      authority: { acknowledgedInputSequence: 10 },
      nativeMovementInput: { epoch: 'session-a', release: { code: 'KeyW', sequence: 10, neutral: true } },
    };
    const released = {
      ...before,
      authority: { acknowledgedInputSequence: 12 },
      nativeMovementInput: { epoch: 'session-a', release: { code: 'KeyW', sequence: 12, neutral: true } },
      player: [0, 0, 0] as const,
      serverPlayerPosition: [0, 0, 0] as const,
      serverPlayerVelocity: [0, 0, 0] as const,
      onGround: true,
      colliding: false,
    };
    const settled = routePulseSettledPredicate(before);
    expect(settled(released)).toBe(true);
    expect(settled({ ...released, nativeMovementInput: before.nativeMovementInput })).toBe(false);
    expect(settled({ ...released, nativeMovementInput: { ...released.nativeMovementInput, epoch: 'session-b' } })).toBe(
      false,
    );
    expect(
      settled({
        ...released,
        nativeMovementInput: {
          ...released.nativeMovementInput,
          release: { code: 'KeyW', sequence: 12, neutral: false },
        },
      }),
    ).toBe(false);
    expect(settled({ ...released, authority: { acknowledgedInputSequence: 11 } })).toBe(false);
    expect(settled({ ...released, nativeMovementInput: null })).toBe(false);
    expect(routePulseSettledPredicate({ authority: before.authority })(released)).toBe(false);
  });
  it('Browser06固定80ms脉冲越过原窄走廊，反向修正仍越窗', () => {
    let body: BodyState = { position: failedPosition, velocity: { x: 0, y: 0, z: 0 } };
    for (let attempt = 0; attempt < 4; attempt++) {
      body = pulse(body, 80, 60);
      expect(
        reachedRouteTarget([body.position.x, body.position.y, body.position.z], corridorTarget, 'KeyW', 0.06, 0.08),
      ).toBe(false);
    }
  });
  it.each([30, 60, 120])('%iHz 的末段真实脉冲在原0.06/0.08窗口内收敛，最大80ms不变', (hz) => {
    let body: BodyState = { position: failedPosition, velocity: { x: 0, y: 0, z: 0 } };
    let arrived = false;
    for (let attempt = 0; attempt < 6; attempt++) {
      const position = [body.position.x, body.position.y, body.position.z] as const;
      const milliseconds = routePulseDurationMs(position, corridorTarget, 80);
      expect(milliseconds).toBeLessThanOrEqual(80);
      expect(milliseconds).toBeGreaterThan(0);
      body = pulse(body, milliseconds, hz);
      arrived = reachedRouteTarget(
        [body.position.x, body.position.y, body.position.z],
        corridorTarget,
        'KeyW',
        0.06,
        0.08,
      );
      if (arrived) break;
    }
    expect(arrived).toBe(true);
  });
  it('does not finish a released pulse while Authority still moves or presentation is stale', () => {
    const observation = {
      player: [41.546707, 32.6, 0.500499] as const,
      serverPlayerPosition: [40.796717, 32.6, 0.500499] as const,
      serverPlayerVelocity: [-4.5, 0, 0] as const,
    };
    expect(routeInputSettled(observation)).toBe(false);
    expect(routeInputSettled({ ...observation, serverPlayerVelocity: [0, 0, 0] })).toBe(false);
    expect(
      routeInputSettled({
        ...observation,
        player: observation.serverPlayerPosition,
        serverPlayerVelocity: [0, 0, 0],
      }),
    ).toBe(true);
    expect(
      routeInputSettled({
        ...observation,
        player: observation.serverPlayerPosition,
        serverPlayerVelocity: [NaN, 0, 0],
      }),
    ).toBe(false);
  });
  it('accepts a target crossed between hosted-renderer snapshots', () => {
    expect(reachedRouteTarget([45.1, 61.6, 1.43], [44.8, 0.5], 'KeyW', 0.65, 1.5)).toBe(true);
    expect(reachedRouteTarget([44.5, 61.6, 1.43], [44.8, 0.5], 'KeyS', 0.65, 1.5)).toBe(true);
  });

  it('does not accept progress before the target or outside its route corridor', () => {
    expect(reachedRouteTarget([43, 61.6, 0.5], [44.8, 0.5], 'KeyW', 0.65, 1.5)).toBe(false);
    expect(reachedRouteTarget([47, 61.6, 2.1], [44.8, 0.5], 'KeyW', 0.65, 1.5)).toBe(false);
  });
});
