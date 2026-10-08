import type * as pc from 'playcanvas';
import { bodyConfigFor } from '@seedlands/stdlib/physics';
import { sampleWaterImmersion } from '@seedlands/stdlib/world/water-immersion';
import type { PlayerControllerOptions } from './player-controller-types';
import { PLAYER_FEET_OFFSET } from './player-view-offsets';

export function samplePlayerWaterImmersion(
  camera: pc.Entity,
  world: NonNullable<ReturnType<PlayerControllerOptions['getWorld']>>,
  previousCameraSubmerged: boolean,
) {
  const position = camera.getPosition();
  const bounds = bodyConfigFor('player').localAabb;
  const feetY = position.y - PLAYER_FEET_OFFSET;
  return sampleWaterImmersion({
    cameraPosition: [position.x, position.y, position.z],
    bodyBounds: {
      min: [position.x + bounds.min.x, feetY + bounds.min.y, position.z + bounds.min.z],
      max: [position.x + bounds.max.x, feetY + bounds.max.y, position.z + bounds.max.z],
    },
    previousCameraSubmerged,
    getVoxel: (x, y, z) => world.getVoxel(x, y, z),
    getFluidLevel: (x, y, z) => world.getFluidCell(x, y, z)?.level ?? null,
  });
}
