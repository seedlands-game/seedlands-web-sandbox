import { describe, expect, it } from 'vitest';
import {
  buildRouteTransportMotionCandidateV1,
  buildSurfaceTransportMotionCandidateV1,
  commitTransportMotionCandidateV1,
  deriveMountedSeatConstraintV1,
  type RouteSegmentV1,
} from '../../src/server/composition/mod-api';
import {
  clear,
  corner,
  descending,
  directedCases,
  guideway,
  policy,
  reference,
  routeState,
  routeTransport,
  straight,
  surfaceDefinition,
  surfaceState,
} from './transport-motion-test-fixtures';

describe('transport motion candidates', () => {
  it.each(directedCases)('advances directed route edge $variant without NaN', (segment) => {
    const start = advanceRouteSegmentV1(segment, 0, 0);
    const source = routeState(segment, 0, {
      velocity: start.tangent.map((component) => component * segment.length) as [number, number, number],
    });
    const candidate = buildRouteTransportMotionCandidateV1(guideway(), routeTransport(), source, {
      ...policy,
      seconds: 1,
      maxSpeed: 2,
      segment,
      resolveNext: () => ({ status: 'disconnected' }),
      sweep: clear,
    });
    const end = advanceRouteSegmentV1(segment, 0, segment.length);

    expect(candidate.stopReason).toBeNull();
    expect(candidate.next.routeCursor?.progress).toBeCloseTo(segment.length);
    expect(candidate.next.pose.position).toEqual(end.position);
    expect([...candidate.next.pose.position, ...candidate.next.velocity].every(Number.isFinite)).toBe(true);
  });

  it('covers every directed edge in the frozen route definition', () => {
    expect(directedCases).toHaveLength(14);
  });

  it('follows a reverse slope downward and a quarter curve by arc length with finite pose', () => {
    const slope = descending();
    const slopeState = routeState(slope);
    const down = buildRouteTransportMotionCandidateV1(guideway(), routeTransport(), slopeState, {
      ...policy,
      segment: slope,
      resolveNext: () => ({ status: 'disconnected' }),
      sweep: clear,
    });
    expect(down.next.pose.position[1]).toBeLessThan(slopeState.pose.position[1]);
    expect(down.next.routeCursor?.progress).toBeCloseTo(0.5);
    expect(down.next.velocity[1]).toBeLessThan(0);

    const curve = corner();
    const turn = buildRouteTransportMotionCandidateV1(guideway(), routeTransport(), routeState(curve), {
      ...policy,
      segment: curve,
      resolveNext: () => ({ status: 'disconnected' }),
      sweep: clear,
    });
    expect(turn.next.routeCursor?.progress).toBeCloseTo(0.5);
    expect(turn.next.pose.yaw).not.toBe(routeState(curve).pose.yaw);
    expect([...turn.next.pose.position, ...turn.next.velocity].every(Number.isFinite)).toBe(true);
  });

  it('carries overshoot into an injected next segment and stops at unknown or disconnected route frontiers', () => {
    const current = straight();
    const source = routeState(current, 0.75);
    const next = straight();
    const advanced = buildRouteTransportMotionCandidateV1(guideway(), routeTransport(), source, {
      ...policy,
      segment: current,
      resolveNext: () => ({ status: 'segment', cell: [1, 0, 0], segment: next }),
      sweep: clear,
    });
    expect(advanced.next.routeCursor).toMatchObject({ cell: [1, 0, 0], progress: 0.25 });
    expect(advanced.traveledDistance).toBeCloseTo(0.5);

    for (const status of ['unknown', 'disconnected', 'ambiguous'] as const) {
      const stopped = buildRouteTransportMotionCandidateV1(guideway(), routeTransport(), source, {
        ...policy,
        segment: current,
        resolveNext: () => ({ status }),
        sweep: clear,
      });
      expect(stopped.stopReason).toBe(`route-${status}`);
      expect(stopped.next.velocity).toEqual([0, 0, 0]);
      expect(stopped.next.routeCursor?.progress).toBe(1);
    }

    expect(() =>
      buildRouteTransportMotionCandidateV1(guideway(), routeTransport(), source, {
        ...policy,
        segment: current,
        resolveNext: () => ({ status: 'segment', cell: [2, 0, 0], segment: next }),
        sweep: clear,
      }),
    ).toThrow(/continuous/i);
    expect(() =>
      buildRouteTransportMotionCandidateV1(guideway(), routeTransport(), source, {
        ...policy,
        segment: current,
        resolveNext: () => ({ status: 'segment', cell: [1, 0, 0], segment: { ...next, family: 'sample:other' } }),
        sweep: clear,
      }),
    ).toThrow(/family/i);
  });

  it('carries overshoot across more than two segments and bounds cyclic route traversal', () => {
    const segment = straight();
    const source = routeState(segment, 0.75, { velocity: [4, 0, 0] });
    const advanced = buildRouteTransportMotionCandidateV1(guideway(), routeTransport(), source, {
      ...policy,
      seconds: 0.5,
      maxSpeed: 8,
      segment,
      resolveNext: ({ cell }) => ({ status: 'segment', cell: [cell[0] + 1, 0, 0], segment }),
      sweep: clear,
    });
    expect(advanced).toMatchObject({ traveledDistance: 2, stopReason: null });
    expect(advanced.next.routeCursor).toMatchObject({ cell: [2, 0, 0], progress: 0.75 });

    let resolved = 0;
    const bounded = buildRouteTransportMotionCandidateV1(
      guideway(),
      routeTransport(),
      routeState(segment, 0, { velocity: [100, 0, 0] }),
      {
        ...policy,
        seconds: 1,
        maxSpeed: 100,
        segment,
        resolveNext: ({ cell }) => {
          resolved += 1;
          return { status: 'segment', cell: [cell[0] + 1, 0, 0], segment };
        },
        sweep: clear,
      },
    );
    expect(bounded.stopReason).toBe('transition-limit');
    expect(bounded.next.velocity).toEqual([0, 0, 0]);
    expect(resolved).toBe(64);
  });

  it.each([
    ['world-collision', 'world-collision'],
    ['entity-collision', 'entity-collision'],
    ['unknown', 'frontier-unknown'],
  ] as const)('stops before route movement on %s without charging fuel', (collision, reason) => {
    const segment = straight();
    const source = routeState(segment, 0, { fuel: 5 });
    const candidate = buildRouteTransportMotionCandidateV1(guideway(), routeTransport(), source, {
      ...policy,
      fuelPerMeter: 2,
      segment,
      resolveNext: () => ({ status: 'disconnected' }),
      sweep: () => collision,
    });
    expect(candidate).toMatchObject({ traveledDistance: 0, fuelCost: 0, stopReason: reason });
    expect(candidate.next.pose).toEqual(source.pose);
    expect(source.fuel).toBe(5);
  });

  it('applies surface steering and drag, but stops before leaving loaded support', () => {
    const source = surfaceState();
    const moved = buildSurfaceTransportMotionCandidateV1(surfaceDefinition(), source, {
      seconds: 1,
      throttle: 0,
      acceleration: 0,
      drag: Math.log(2),
      maxSpeed: 8,
      fuelPerMeter: 0,
      steering: 0.5,
      steeringRate: Math.PI / 2,
      sampleSurface: () => 'supported',
      sweep: clear,
    });
    expect(moved.next.pose.yaw).toBeCloseTo(Math.PI / 4);
    expect(Math.hypot(moved.next.velocity[0], moved.next.velocity[2])).toBeCloseTo(2);
    expect([...moved.next.pose.position, ...moved.next.velocity].every(Number.isFinite)).toBe(true);

    for (const [support, reason] of [
      ['unsupported', 'left-surface'],
      ['unknown', 'surface-unknown'],
    ] as const) {
      const stopped = buildSurfaceTransportMotionCandidateV1(surfaceDefinition(), source, {
        ...policy,
        steering: 0,
        steeringRate: 1,
        sampleSurface: () => support,
        sweep: clear,
      });
      expect(stopped).toMatchObject({ traveledDistance: 0, fuelCost: 0, stopReason: reason });
      expect(stopped.next.pose).toEqual(source.pose);
    }
  });

  it('moves and steers surface transport in reverse with finite signed velocity', () => {
    const source = surfaceState({ velocity: [0, 0, 0] });
    const reversed = buildSurfaceTransportMotionCandidateV1(surfaceDefinition(), source, {
      seconds: 1,
      throttle: -1,
      acceleration: 2,
      drag: 0,
      maxSpeed: 4,
      fuelPerMeter: 0,
      steering: 0.5,
      steeringRate: Math.PI / 2,
      sampleSurface: () => 'supported',
      sweep: clear,
    });
    expect(reversed.traveledDistance).toBeCloseTo(1);
    expect(reversed.next.pose.position[2]).toBeLessThan(source.pose.position[2]);
    expect(reversed.next.pose.yaw).toBeCloseTo(-Math.PI / 4);
    expect(reversed.next.velocity[2]).toBeLessThan(0);
    expect([...reversed.next.pose.position, ...reversed.next.velocity].every(Number.isFinite)).toBe(true);
  });

  it('consumes fuel only when a fresh advance candidate is committed', () => {
    const source = surfaceState({ fuel: 1 });
    const candidate = buildSurfaceTransportMotionCandidateV1(surfaceDefinition(), source, {
      seconds: 1,
      throttle: 0,
      acceleration: 0,
      drag: 0,
      maxSpeed: 8,
      fuelPerMeter: 2,
      steering: 0,
      steeringRate: 1,
      sampleSurface: () => 'supported',
      sweep: clear,
    });
    expect(candidate).toMatchObject({ traveledDistance: 0.5, fuelCost: 1, stopReason: 'fuel-empty' });
    expect(Object.isFrozen(candidate)).toBe(true);
    expect(Object.isFrozen(candidate.expected)).toBe(true);
    expect(Object.isFrozen(candidate.next)).toBe(true);
    expect(Object.isFrozen(candidate.next.pose)).toBe(true);
    expect(Object.isFrozen(candidate.next.velocity)).toBe(true);
    expect(source.fuel).toBe(1);
    const committed = commitTransportMotionCandidateV1(source, candidate);
    expect(committed.fuel).toBe(0);
    expect(committed.pose.position[2]).toBeCloseTo(0.5);
    expect(() => commitTransportMotionCandidateV1({ ...source, fuel: 0.5 }, candidate)).toThrow(/stale/i);
    expect(() =>
      commitTransportMotionCandidateV1(source, {
        ...candidate,
        next: { ...candidate.next, routeCursor: { ...routeState(straight()).routeCursor!, progress: Number.NaN } },
      }),
    ).toThrow(/cursor/i);
  });

  it('stops in the same candidate when fuel is exhausted exactly', () => {
    const source = surfaceState({ fuel: 2, velocity: [0, 0, 2] });
    const candidate = buildSurfaceTransportMotionCandidateV1(surfaceDefinition(), source, {
      seconds: 1,
      throttle: 0,
      acceleration: 0,
      drag: 0,
      maxSpeed: 8,
      fuelPerMeter: 1,
      steering: 0,
      steeringRate: 1,
      sampleSurface: () => 'supported',
      sweep: clear,
    });
    expect(candidate).toMatchObject({ traveledDistance: 2, fuelCost: 2, stopReason: 'fuel-empty' });
    expect(candidate.next.velocity).toEqual([0, 0, 0]);
    expect(commitTransportMotionCandidateV1(source, candidate).fuel).toBe(0);
  });

  it('derives a rotated seat pose and declares mounted walking disabled without writing the rider', () => {
    const rider = reference('actor-a', 30);
    const source = surfaceState({ pose: { position: [10, 2, 20], yaw: Math.PI / 2 }, rider });
    const seat = deriveMountedSeatConstraintV1(surfaceDefinition(), source);
    expect(seat).toMatchObject({ rider, walkingEnabled: false, pose: { yaw: Math.PI / 2 } });
    expect(seat?.pose.position[0]).toBeCloseTo(10);
    expect(seat?.pose.position[1]).toBeCloseTo(2.4);
    expect(seat?.pose.position[2]).toBeCloseTo(19.5);
    expect(source.rider).toEqual(rider);
    expect(deriveMountedSeatConstraintV1(surfaceDefinition(), surfaceState())).toBeNull();
  });

  it('is step-slicing equivalent for constant surface inputs and rejects non-finite motion inputs', () => {
    const definition = surfaceDefinition();
    const run = (hz: 30 | 60 | 120) => {
      let current = surfaceState();
      for (let step = 0; step < hz; step += 1) {
        const candidate = buildSurfaceTransportMotionCandidateV1(definition, current, {
          seconds: 1 / hz,
          throttle: 0,
          acceleration: 0,
          drag: Math.log(2),
          maxSpeed: 8,
          fuelPerMeter: 0,
          steering: 0,
          steeringRate: 1,
          sampleSurface: () => 'supported',
          sweep: clear,
        });
        current = commitTransportMotionCandidateV1(current, candidate);
      }
      return current;
    };
    const thirty = run(30);
    const sixty = run(60);
    const oneTwenty = run(120);
    expect(thirty.pose.position[2]).toBeCloseTo(sixty.pose.position[2], 10);
    expect(sixty.pose.position[2]).toBeCloseTo(oneTwenty.pose.position[2], 10);
    expect(thirty.velocity[2]).toBeCloseTo(2, 10);
    expect(() =>
      buildSurfaceTransportMotionCandidateV1(definition, surfaceState(), {
        ...policy,
        seconds: Number.NaN,
        steering: 0,
        steeringRate: 1,
        sampleSurface: () => 'supported',
        sweep: clear,
      }),
    ).toThrow(/policy/i);
  });

  it('is step-slicing equivalent when acceleration reaches max speed during a surface step', () => {
    const definition = surfaceDefinition();
    const run = (hz: 30 | 60 | 120) => {
      let current = surfaceState({ velocity: [0, 0, 7] });
      for (let step = 0; step < hz; step += 1)
        current = commitTransportMotionCandidateV1(
          current,
          buildSurfaceTransportMotionCandidateV1(definition, current, {
            seconds: 1 / hz,
            throttle: 1,
            acceleration: 4,
            drag: 0,
            maxSpeed: 8,
            fuelPerMeter: 0,
            steering: 0,
            steeringRate: 1,
            sampleSurface: () => 'supported',
            sweep: clear,
          }),
        );
      return current;
    };
    expect(run(30).pose.position[2]).toBeCloseTo(run(60).pose.position[2], 10);
    expect(run(60).pose.position[2]).toBeCloseTo(run(120).pose.position[2], 10);
    expect(run(120).pose.position[2]).toBeCloseTo(7.875, 10);
  });

  it('rejects invalid injected results and malformed route segment configuration', () => {
    expect(() =>
      buildSurfaceTransportMotionCandidateV1(surfaceDefinition(), surfaceState(), {
        ...policy,
        steering: 0,
        steeringRate: 1,
        sampleSurface: () => 'lava' as never,
        sweep: clear,
      }),
    ).toThrow(/surface/i);
    expect(() =>
      buildSurfaceTransportMotionCandidateV1(surfaceDefinition(), surfaceState(), {
        ...policy,
        steering: 0,
        steeringRate: 1,
        sampleSurface: () => 'supported',
        sweep: () => 'teleport' as never,
      }),
    ).toThrow(/collision/i);
    const segment = straight();
    const malformed = { ...segment, edge: { ...segment.edge, curve: 'quarter' } } as unknown as RouteSegmentV1;
    expect(() =>
      buildRouteTransportMotionCandidateV1(guideway(), routeTransport(), routeState(segment), {
        ...policy,
        segment: malformed,
        resolveNext: () => ({ status: 'disconnected' }),
        sweep: clear,
      }),
    ).toThrow(/segment/i);
    expect(() =>
      buildRouteTransportMotionCandidateV1(
        guideway(),
        routeTransport(),
        routeState(segment, 0, { velocity: [0, 0, 2] }),
        {
          ...policy,
          segment,
          resolveNext: () => ({ status: 'disconnected' }),
          sweep: clear,
        },
      ),
    ).toThrow(/velocity/i);
    expect(() =>
      buildRouteTransportMotionCandidateV1(guideway(), routeTransport(), routeState(segment, 0.75), {
        ...policy,
        segment,
        resolveNext: () => ({ status: 'teleport' }) as never,
        sweep: clear,
      }),
    ).toThrow(/route resolution/i);
  });
});
