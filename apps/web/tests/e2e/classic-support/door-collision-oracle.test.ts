import { describe, expect, it } from 'vitest';
import { bodyConfigFor } from '@seedlands/stdlib/physics/body-registry';
import { sweepBodyThroughWorld } from '@seedlands/stdlib/physics/geometry';
import {
  assessClosedDoorProbe,
  createClosedDoorProbePlan,
  type ClosedDoorProbeObservation,
} from './door-collision-oracle';

const door = [70, 31, 0] as const;
const collision = { min: [0.8125, 0, 0] as const, max: [1, 1, 1] as const };
const playerConfig = bodyConfigFor('player');
const playerHalfWidth = Math.max(
  -playerConfig.localAabb.min.x,
  playerConfig.localAabb.max.x,
  -playerConfig.localAabb.min.z,
  playerConfig.localAabb.max.z,
);
const centeredBefore: ClosedDoorProbeObservation = {
  position: [69.4925, 32.6, 0.5],
  acknowledgedInputSequence: 100,
  physicsTick: 1_000,
  onGround: true,
  colliding: false,
};
const plan = createClosedDoorProbePlan({
  door,
  collision,
  playerPosition: centeredBefore.position,
  playerHalfWidth,
});
const observation = (
  position: readonly [number, number, number],
  acknowledgedInputSequence: number,
  physicsTick: number,
): ClosedDoorProbeObservation => ({
  position,
  acknowledgedInputSequence,
  physicsTick,
  onGround: true,
  colliding: false,
});

describe('Classic closed-door collision oracle', () => {
  it('derives a centered orthogonal route from the actual door collision box', () => {
    expect(plan).toMatchObject({
      normalAxis: 0,
      lateralAxis: 2,
      direction: 1,
    });
    expect(plan.contact).toBeCloseTo(70.4925);
    expect(plan.approach[0]).toBeCloseTo(69.4925);
    expect(plan.approach[1]).toBeCloseTo(0.5);
    expect(plan.routeTarget[0]).toBeCloseTo(71.4925);
    expect(plan.routeTarget[1]).toBeCloseTo(0.5);
    expect(plan.safeLateral[0]).toBeCloseTo(0.320004);
    expect(plan.safeLateral[1]).toBeCloseTo(0.679996);
  });

  it('matches the real physics sweep for closed and open door geometry', () => {
    const state = { position: { x: plan.approach[0], y: 31, z: plan.approach[1] }, velocity: { x: 0, y: 0, z: 0 } };
    const closed = sweepBodyThroughWorld(
      state,
      playerConfig,
      {
        querySolids: () => [
          {
            id: 'closed-door',
            aabb: {
              min: { x: door[0] + collision.min[0], y: door[1], z: door[2] + collision.min[2] },
              max: { x: door[0] + collision.max[0], y: door[1] + 1, z: door[2] + collision.max[2] },
            },
          },
        ],
      },
      { x: 2, y: 0, z: 0 },
    );
    const open = sweepBodyThroughWorld(state, playerConfig, { querySolids: () => [] }, { x: 2, y: 0, z: 0 });

    expect(closed.position.x).toBeCloseTo(plan.contact, 5);
    expect(closed.contacts).toHaveLength(1);
    expect(open.position.x).toBeCloseTo(plan.routeTarget[0]);
    expect(open.contacts).toHaveLength(0);
  });

  it('derives the same orthogonal contract for a Z-normal door', () => {
    const zNormal = createClosedDoorProbePlan({
      door: [3, 31, 4],
      collision: { min: [0, 0, 0], max: [1, 1, 0.1875] },
      playerPosition: [3.5, 32.6, 2],
      playerHalfWidth,
    });

    expect(zNormal).toMatchObject({ normalAxis: 2, lateralAxis: 0, direction: 1 });
    expect(zNormal.contact).toBeCloseTo(3.68);
    expect(zNormal.approach[0]).toBeCloseTo(3.5);
    expect(zNormal.approach[1]).toBeCloseTo(2.68);
    expect(zNormal.routeTarget[0]).toBeCloseTo(3.5);
    expect(zNormal.routeTarget[1]).toBeCloseTo(4.68);
  });

  it('accepts fresh orthogonal progress that reaches and remains at the derived contact plane', () => {
    expect(
      assessClosedDoorProbe(plan, centeredBefore, [
        observation([70.2, 32.6, 0.5], 110, 1_010),
        observation([70.4924995, 32.6, 0.5], 120, 1_020),
        observation([70.4924995, 32.6, 0.5], 127, 1_027),
      ]),
    ).toEqual({ status: 'blocked' });
  });

  it('rejects the Browser-09 diagonal trace that slides around the finite door edge', () => {
    const browser09Before = observation([68.46859339486005, 32.6, -0.4489545940748269], 5_549, 12_326);
    const browser09Plan = createClosedDoorProbePlan({
      door,
      collision,
      playerPosition: browser09Before.position,
      playerHalfWidth,
    });

    expect(
      assessClosedDoorProbe(browser09Plan, browser09Before, [
        observation([70.49249948474204, 32.6, 0.7199951193123576], 5_600, 12_380),
        observation([70.49249948474204, 32.6, 1.32061353847437], 5_630, 12_406),
        observation([71.12895363774116, 32.6, 1.5747307585831414], 5_640, 12_417),
      ]),
    ).toEqual({ status: 'invalid', reason: 'outside-safe-corridor' });
  });

  it('rejects a no-collision trace that crosses the contact plane', () => {
    expect(
      assessClosedDoorProbe(plan, centeredBefore, [
        observation([70.3, 32.6, 0.5], 110, 1_010),
        observation([70.7, 32.6, 0.5], 120, 1_020),
      ]),
    ).toEqual({ status: 'invalid', reason: 'crossed-contact-plane' });
  });

  it('rejects fresh acknowledgements without movement', () => {
    expect(assessClosedDoorProbe(plan, centeredBefore, [observation(centeredBefore.position, 110, 1_010)])).toEqual({
      status: 'pending',
      reason: 'insufficient-progress',
    });
  });

  it('rejects a lateral excursion before it can be counted as blocking', () => {
    expect(assessClosedDoorProbe(plan, centeredBefore, [observation([70.4924995, 32.6, 0.7], 120, 1_020)])).toEqual({
      status: 'invalid',
      reason: 'outside-safe-corridor',
    });
  });

  it('rejects contact observations without a fresh acknowledged input', () => {
    expect(
      assessClosedDoorProbe(plan, centeredBefore, [
        observation([70.4924995, 32.6, 0.5], 100, 1_020),
        observation([70.4924995, 32.6, 0.5], 100, 1_027),
      ]),
    ).toEqual({ status: 'pending', reason: 'stale-input' });
  });

  it('rejects an ungrounded or already colliding starting body', () => {
    expect(
      assessClosedDoorProbe(plan, { ...centeredBefore, onGround: false }, [
        observation([70.4924995, 32.6, 0.5], 120, 1_020),
      ]),
    ).toEqual({ status: 'invalid', reason: 'body-not-ready' });
    expect(
      assessClosedDoorProbe(plan, { ...centeredBefore, colliding: true }, [
        observation([70.4924995, 32.6, 0.5], 120, 1_020),
      ]),
    ).toEqual({ status: 'invalid', reason: 'body-not-ready' });
  });
});
