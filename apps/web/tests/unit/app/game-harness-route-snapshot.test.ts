import { describe, expect, it } from 'vitest';
import type { BrowserAuthorityClient } from '../../../src/client/authority/browser-authority-client';
import { createHarnessRouteSnapshot, createHarnessSnapshot } from '../../../src/app/game-harness';
import type { PlayerController } from '../../../src/app/player/player-controller';
import type { AuthoritySnapshot } from '../../../../../packages/stdlib/src/server/authority/authority-session';

type OwnerOverrides = Readonly<{
  controller?: Readonly<{
    position?: Readonly<{ x: number; y: number; z: number }>;
    viewAngles?: readonly [number, number];
    onGround?: boolean;
    isColliding?: boolean;
  }> | null;
  authority?: Readonly<{ isReady?: boolean; snapshot?: Partial<AuthoritySnapshot> }> | null;
}>;

const owners = (overrides: OwnerOverrides = {}) => {
  const controller =
    overrides.controller === null
      ? null
      : ({
          position: { x: 12.25, y: 34.5, z: -7.75 },
          viewAngles: [91.5, -12.25],
          onGround: true,
          isColliding: false,
          ...overrides.controller,
        } as unknown as PlayerController);
  const baseSnapshot = {
    player: {
      body: {
        position: { x: 13.5, y: 35.125, z: -8.25 },
        velocity: { x: 0, y: 0, z: 0 },
      },
    },
    physicsTick: 481,
    acknowledgedInputSequence: 27,
    entities: [],
    diagnostics: {},
  };
  const snapshotOverride = (overrides.authority as { snapshot?: Partial<AuthoritySnapshot> } | undefined)?.snapshot;
  const snapshot = {
    ...baseSnapshot,
    ...snapshotOverride,
    player: { ...baseSnapshot.player, ...snapshotOverride?.player },
  } as unknown as AuthoritySnapshot;
  const authority =
    overrides.authority === null
      ? null
      : ({
          snapshot,
          isReady: overrides.authority?.isReady ?? true,
          readyState: null,
          storageBytes: 0,
          snapshotRejections: {},
        } as unknown as BrowserAuthorityClient);
  return {
    controller,
    snapshot,
    authority,
    context: {
      world: null,
      environment: null,
      controller,
      frameMs: 16,
      qualityLevel: 'medium' as const,
      authority,
      compute: null,
      logic: null,
      authorityTrajectory: [],
      ui: {} as never,
      presentedEntityCount: 0,
      visualEffects: null,
      underwaterVisual: null,
    },
  };
};

const expectedRouteSnapshot = {
  player: [12.25, 34.5, -7.75],
  serverPlayerPosition: [13.5, 36.725, -8.25],
  serverPlayerVelocity: [0, 0, 0],
  viewAngles: [91.5, -12.25],
  onGround: true,
  colliding: false,
  authority: { physicsTick: 481, acknowledgedInputSequence: 27 },
};

describe('harness route snapshot projection', () => {
  it('exposes exactly the route owner values and copies all position/view tuples', () => {
    const source = owners();
    const projected = createHarnessRouteSnapshot(source.context);
    expect(projected).toEqual(expectedRouteSnapshot);
  });

  it('copies position, velocity and view arrays without mutating their owners', () => {
    const source = owners();
    const projected = createHarnessRouteSnapshot(source.context);
    expect(projected).not.toBeNull();
    for (const [tuple, index] of [
      [projected!.player, 0],
      [projected!.serverPlayerPosition, 1],
      [projected!.serverPlayerVelocity, 2],
      [projected!.viewAngles, 0],
    ] as const) {
      try {
        (tuple as unknown as number[])[index] = -999;
      } catch (error) {
        expect(error).toBeInstanceOf(TypeError);
      }
    }
    expect(source.controller?.position).toEqual({ x: 12.25, y: 34.5, z: -7.75 });
    expect(source.snapshot.player.body.position).toEqual({ x: 13.5, y: 35.125, z: -8.25 });
    expect(source.snapshot.player.body.velocity).toEqual({ x: 0, y: 0, z: 0 });
    expect(source.controller?.viewAngles).toEqual([91.5, -12.25]);
  });

  it.each([
    ['missing controller', { controller: null }],
    ['missing Authority', { authority: null }],
    ['Authority not ready', { authority: { isReady: false } }],
  ])('%s fails closed instead of returning synthetic route coordinates', (_label, overrides) => {
    const source = owners(overrides);
    expect(createHarnessRouteSnapshot(source.context)).toBeNull();
  });

  const invalidOwnerCases: ReadonlyArray<readonly [string, OwnerOverrides]> = [
    ['non-finite player coordinate', { controller: { position: { x: Number.NaN, y: 34.5, z: -7.75 } } }],
    ['non-finite heading', { controller: { viewAngles: [Number.NaN, -12.25] as const } }],
    ['negative tick', { authority: { snapshot: { physicsTick: -1 } } }],
    ['non-integer tick', { authority: { snapshot: { physicsTick: 1.5 } } }],
    ['invalid ack', { authority: { snapshot: { acknowledgedInputSequence: -2 } } }],
  ];
  it.each(invalidOwnerCases)('%s is rejected as invalid route evidence', (_label, overrides) => {
    const source = owners(overrides);
    expect(createHarnessRouteSnapshot(source.context)).toBeNull();
  });

  it('retains the existing complete diagnostic snapshot as a separate API', () => {
    const source = owners();
    const full = createHarnessSnapshot(source.context);
    expect(full).toMatchObject({
      frameMs: 16,
      player: expectedRouteSnapshot.player,
      serverPlayerPosition: expectedRouteSnapshot.serverPlayerPosition,
      serverPlayerVelocity: expectedRouteSnapshot.serverPlayerVelocity,
      viewAngles: expectedRouteSnapshot.viewAngles,
      onGround: true,
      colliding: false,
      authority: { physicsTick: 481, acknowledgedInputSequence: 27 },
      performance: expect.any(Object),
      experiments: expect.any(Object),
      compute: expect.any(Object),
      waterTransitions: expect.any(Object),
    });
  });
});
