import { describe, expect, it, vi } from 'vitest';
import * as pc from 'playcanvas';
import { Voxel } from '@seedlands/stdlib/world/voxel';
import { PlayerController } from '../../../src/app/player/player-controller';

const target = (
  input: Readonly<{
    canTargetFluidSource: () => boolean;
    voxelAt: (z: number) => number;
    fluidAt?: (z: number) => { level: number; source: boolean } | null;
    semantics?: (voxel: number) => { targetable: boolean } | undefined;
  }>,
) => {
  const camera = new pc.Entity();
  camera.setPosition(0.5, 32.600001, 0.5);
  const controller = new PlayerController({
    camera,
    canvas: {} as HTMLCanvasElement,
    physicsHz: 60,
    authority: { epoch: 'world:1', snapshot: () => null, sendInput: vi.fn(), setPlayerPosition: vi.fn() },
    getWorld: () =>
      ({
        authority: {
          voxelSemantics: {
            get: (voxel: number) =>
              input.semantics?.(voxel) ??
              (voxel === Voxel.Air
                ? { targetable: false }
                : voxel === Voxel.Water
                  ? { targetable: false }
                  : voxel === Voxel.Stone
                    ? { targetable: true }
                    : undefined),
          },
        },
        getVoxel: (_x: number, _y: number, z: number) => input.voxelAt(z),
        getFluidCell: (_x: number, _y: number, z: number) => input.fluidAt?.(z) ?? null,
      }) as never,
    getEnvironment: () => null,
    canTargetFluidSource: input.canTargetFluidSource,
    isUiBlockingInput: () => false,
  } as never);
  controller.setView(0, 0);
  return controller.aimTarget;
};

describe('PlayerController fluid source target', () => {
  it('targets a registered full source only while the current selected item permits it', () => {
    let enabled = false;
    const read = () =>
      target({
        canTargetFluidSource: () => enabled,
        voxelAt: (z) => (z === -2 ? Voxel.Water : Voxel.Air),
        fluidAt: (z) => (z === -2 ? { source: true, level: 8 } : null),
      });

    expect(read()).toBeNull();
    enabled = true;
    expect(read()).toMatchObject({ position: [0, 32, -2], voxel: Voxel.Water });
    enabled = false;
    expect(read()).toBeNull();
  });

  it('rejects flowing fluid and does not cross an unknown cell to a source', () => {
    expect(
      target({
        canTargetFluidSource: () => true,
        voxelAt: (z) => (z === -2 ? Voxel.Water : Voxel.Air),
        fluidAt: (z) => (z === -2 ? { source: false, level: 7 } : null),
      }),
    ).toBeNull();
    expect(
      target({
        canTargetFluidSource: () => true,
        voxelAt: (z) => (z === -1 ? 500 : z === -2 ? Voxel.Water : Voxel.Air),
        fluidAt: (z) => (z === -2 ? { source: true, level: 8 } : null),
      }),
    ).toBeNull();
  });

  it('hits a targetable wall before a source behind it', () => {
    expect(
      target({
        canTargetFluidSource: () => true,
        voxelAt: (z) => (z === -1 ? Voxel.Stone : z === -2 ? Voxel.Water : Voxel.Air),
        fluidAt: (z) => (z === -2 ? { source: true, level: 8 } : null),
      }),
    ).toMatchObject({ position: [0, 32, -1], voxel: Voxel.Stone });
  });
});
