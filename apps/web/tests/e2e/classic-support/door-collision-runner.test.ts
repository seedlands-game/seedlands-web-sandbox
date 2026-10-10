import { expect, it } from 'vitest';
import { assessClosedDoorProbe } from './door-collision-oracle';
import type { ClosedDoorProbeObservation, ClosedDoorProbePlan } from './door-collision-oracle';
import { collectDoorCollisionObservations } from './door-collision-runner';

const contact = 70.492499;
const before: ClosedDoorProbeObservation = {
  position: [69.5544, 32.6, 0.5],
  acknowledgedInputSequence: 331_210,
  physicsTick: 24_212,
  onGround: true,
  colliding: false,
};
const plan: ClosedDoorProbePlan = {
  normalAxis: 0,
  lateralAxis: 2,
  direction: 1,
  contact,
  approach: [68.5, 0.5],
  routeTarget: [71.5, 0.5],
  safeLateral: [0.4, 0.6],
};
const maximumPhysicsTick = before.physicsTick + 75;
const deadlineMs = 1_250;
type Observation = ClosedDoorProbeObservation;

function simulation() {
  let nowMs = 0;
  let yieldCount = 0;
  const observe = async (): Promise<Observation> => {
    const tickDelta = Math.floor((nowMs * 60) / 1_000);
    const physicsTick = before.physicsTick + tickDelta;
    const positionX = Math.min(contact, before.position[0] + tickDelta * 0.016);
    return {
      position: [positionX, before.position[1], before.position[2]],
      acknowledgedInputSequence: before.acknowledgedInputSequence + (tickDelta > 0 ? 1 : 0),
      physicsTick,
      onGround: true,
      colliding: false,
    };
  };
  return {
    observe,
    clock: () => nowMs,
    yieldFor: async (milliseconds: number) => {
      yieldCount += 1;
      nowMs += milliseconds;
    },
    yieldCount: () => yieldCount,
  };
}

it('polls distinct Authority ticks through a stalled-renderer window and preserves the six-tick hold', async () => {
  const clock = simulation();
  let assessment = assessClosedDoorProbe(plan, before, []);
  const observations = await collectDoorCollisionObservations({
    initialPhysicsTick: before.physicsTick,
    maximumPhysicsTick,
    deadlineMs,
    now: clock.clock,
    observe: clock.observe,
    yieldControl: clock.yieldFor,
    isComplete: (current) => {
      assessment = assessClosedDoorProbe(plan, before, current);
      return assessment.status !== 'pending';
    },
  });

  expect(observations.length).toBeGreaterThan(7);
  expect(
    observations.every(
      (observation, index) => index === 0 || observation.physicsTick > observations[index - 1]!.physicsTick,
    ),
  ).toBe(true);
  expect(observations.at(-1)?.physicsTick).toBeLessThanOrEqual(maximumPhysicsTick);
  expect(clock.yieldCount()).toBeGreaterThan(0);
  expect(clock.clock()).toBeLessThan(deadlineMs);
  expect(assessment).toEqual({ status: 'blocked' });
});

it('does not accept an RPC that returns after the wall deadline', async () => {
  let now = 0;
  const observations = await collectDoorCollisionObservations({
    initialPhysicsTick: 0,
    maximumPhysicsTick: 75,
    deadlineMs: 1250,
    now: () => now,
    observe: async () => {
      now = 1404;
      return { physicsTick: 70 };
    },
    yieldControl: async () => undefined,
    isComplete: (current) => current.length > 0,
  });
  expect(observations).toEqual([]);
});

it('does not use a post-budget physics tick as blocking evidence', async () => {
  const observations = await collectDoorCollisionObservations({
    initialPhysicsTick: 0,
    maximumPhysicsTick: 75,
    deadlineMs: 1250,
    now: () => 100,
    observe: async () => ({ physicsTick: 93 }),
    yieldControl: async () => undefined,
    isComplete: (current) => current.length > 0,
  });
  expect(observations).toEqual([]);
});
