import { describe, expect, it } from 'vitest';
import {
  constrainClimbVelocityV1,
  defineClimbSurfaceV1,
  type ClimbCollisionSampleV1,
  type ClimbConstraintInputV1,
  type LoadedClimbSurfaceV1,
} from '../../src/server/gameplay/modules/climb-surface-model';

const definition = () =>
  defineClimbSurfaceV1({
    version: 1,
    variant: 'sample:climb-panel',
    faceNormal: { x: 1, y: 0, z: 0 },
    contactThickness: 0.125,
    maxUpSpeed: 3.5,
    maxDownSpeed: 2.25,
    requiresHorizontalContact: true,
  });

const actor = (overrides: Partial<ClimbConstraintInputV1['actor']> = {}): ClimbConstraintInputV1['actor'] => ({
  aabb: { min: { x: 1, y: 0.1, z: 0.2 }, max: { x: 1.6, y: 1.9, z: 0.8 } },
  velocity: { x: 1.25, y: 99, z: -0.75 },
  verticalIntent: 1,
  grounded: false,
  ...overrides,
});

const loaded = (overrides: Partial<LoadedClimbSurfaceV1> = {}): ClimbCollisionSampleV1 => ({
  status: 'loaded',
  surface: {
    variant: 'sample:climb-panel',
    aabb: { min: { x: 0.875, y: 0, z: 0 }, max: { x: 1, y: 2, z: 1 } },
    contactNormal: { x: 1, y: 0, z: 0 },
    ...overrides,
  },
});

describe('ClimbSurfaceDefinitionV1', () => {
  it('validates and freezes a generic namespaced surface without content identities', () => {
    const surface = definition();
    expect(surface).toEqual({
      version: 1,
      variant: 'sample:climb-panel',
      faceNormal: { x: 1, y: 0, z: 0 },
      contactThickness: 0.125,
      maxUpSpeed: 3.5,
      maxDownSpeed: 2.25,
      requiresHorizontalContact: true,
    });
    expect(Object.isFrozen(surface)).toBe(true);
    expect(Object.isFrozen(surface.faceNormal)).toBe(true);
    expect(() => defineClimbSurfaceV1({ ...surface, variant: 'panel' })).toThrow(/namespace/i);
    expect(() => defineClimbSurfaceV1({ ...surface, faceNormal: { x: 0, y: 1, z: 0 } })).toThrow(/horizontal/i);
    expect(() => defineClimbSurfaceV1({ ...surface, contactThickness: 0 })).toThrow(/thickness/i);
    expect(() => defineClimbSurfaceV1({ ...surface, maxUpSpeed: Number.POSITIVE_INFINITY })).toThrow(/speed/i);
  });

  it('constrains upward and downward intent to asymmetric maxima while preserving horizontal velocity', () => {
    expect(constrainClimbVelocityV1(definition(), { actor: actor(), collision: loaded() })).toEqual({
      status: 'climbing',
      velocity: { x: 1.25, y: 3.5, z: -0.75 },
    });
    expect(
      constrainClimbVelocityV1(definition(), {
        actor: actor({ velocity: { x: -2, y: -100, z: 4 }, verticalIntent: -1, grounded: true }),
        collision: loaded(),
      }),
    ).toEqual({ status: 'climbing', velocity: { x: -2, y: -2.25, z: 4 } });
  });

  it('requires non-zero vertical intent and does not invent a persistent climbing state', () => {
    expect(
      constrainClimbVelocityV1(definition(), {
        actor: actor({ verticalIntent: 0, velocity: { x: 1, y: -7, z: 2 } }),
        collision: loaded(),
      }),
    ).toEqual({ status: 'not-climbing', reason: 'zero-intent' });
    expect(
      constrainClimbVelocityV1(definition(), { actor: actor(), collision: { status: 'loaded', surface: null } }),
    ).toEqual({
      status: 'not-climbing',
      reason: 'no-surface',
    });
  });

  it('fails closed for an unknown boundary, unknown variant, wrong face or missing horizontal contact', () => {
    expect(constrainClimbVelocityV1(definition(), { actor: actor(), collision: { status: 'unknown' } })).toEqual({
      status: 'not-climbing',
      reason: 'unknown-boundary',
    });
    expect(
      constrainClimbVelocityV1(definition(), {
        actor: actor(),
        collision: loaded({ variant: 'sample:other-surface' }),
      }),
    ).toEqual({ status: 'not-climbing', reason: 'unknown-variant' });
    expect(
      constrainClimbVelocityV1(definition(), {
        actor: actor(),
        collision: loaded({ contactNormal: { x: -1, y: 0, z: 0 } }),
      }),
    ).toEqual({ status: 'not-climbing', reason: 'wrong-face' });
    expect(
      constrainClimbVelocityV1(definition(), {
        actor: actor(),
        collision: loaded({ contactNormal: null }),
      }),
    ).toEqual({ status: 'not-climbing', reason: 'no-contact' });
  });

  it('requires face-specific AABB proximity and tangential overlap within contact thickness', () => {
    expect(
      constrainClimbVelocityV1(definition(), {
        actor: actor({
          aabb: { min: { x: 1.2, y: 0.1, z: 0.2 }, max: { x: 1.8, y: 1.9, z: 0.8 } },
        }),
        collision: loaded(),
      }),
    ).toEqual({ status: 'not-climbing', reason: 'no-contact' });
    expect(
      constrainClimbVelocityV1(definition(), {
        actor: actor({
          aabb: { min: { x: 1, y: 2.1, z: 0.2 }, max: { x: 1.6, y: 3.9, z: 0.8 } },
        }),
        collision: loaded(),
      }),
    ).toEqual({ status: 'not-climbing', reason: 'no-contact' });
  });

  it('supports proximity-only surfaces when horizontal contact is optional', () => {
    const optional = defineClimbSurfaceV1({ ...definition(), requiresHorizontalContact: false });
    expect(
      constrainClimbVelocityV1(optional, {
        actor: actor(),
        collision: loaded({ contactNormal: null }),
      }),
    ).toEqual({ status: 'climbing', velocity: { x: 1.25, y: 3.5, z: -0.75 } });
  });

  it('rejects non-finite actor and collision inputs rather than producing non-finite velocity', () => {
    expect(() =>
      constrainClimbVelocityV1(definition(), {
        actor: actor({ velocity: { x: 0, y: Number.NaN, z: 0 } }),
        collision: loaded(),
      }),
    ).toThrow(/actor/i);
    expect(() =>
      constrainClimbVelocityV1(definition(), {
        actor: actor(),
        collision: loaded({
          aabb: { min: { x: Number.NEGATIVE_INFINITY, y: 0, z: 0 }, max: { x: 1, y: 2, z: 1 } },
        }),
      }),
    ).toThrow(/surface/i);
  });

  it.each([30, 60, 120] as const)(
    'returns the same velocity constraint for equivalent %sHz physics input',
    (physicsHz) => {
      expect(1 / physicsHz).toBeGreaterThan(0);
      const result = constrainClimbVelocityV1(definition(), { actor: actor(), collision: loaded() });
      expect(result).toEqual({ status: 'climbing', velocity: { x: 1.25, y: 3.5, z: -0.75 } });
    },
  );
});
