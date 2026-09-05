import type * as pc from 'playcanvas';
import { macroAt } from '../world/macro-world';
import { sampleWaterFlowDirection } from '../world/water-flow-direction';
import type { WaterImmersionSnapshot } from '../world/water-immersion';
import { UnderwaterVisualEffects } from './underwater-visual-effects';
import type { WorldEnvironment } from './world-environment';
import type { World } from './world-runtime';
import { PLAYER_FEET_OFFSET } from './player-view-offsets';

export class WaterExperience {
  readonly visual: UnderwaterVisualEffects;
  private flowSampleElapsed = Number.POSITIVE_INFINITY;

  constructor(camera: pc.CameraComponent | null, device: pc.GraphicsDevice) {
    this.visual = new UnderwaterVisualEffects(camera, device);
  }

  reset() {
    this.flowSampleElapsed = Number.POSITIVE_INFINITY;
  }

  updateFlow(seconds: number, camera: pc.Entity, world: World, environment: WorldEnvironment) {
    this.flowSampleElapsed += seconds;
    if (this.flowSampleElapsed < 0.25) return;
    this.flowSampleElapsed = 0;
    const position = camera.getPosition();
    const flow = sampleWaterFlowDirection(
      Math.floor(position.x),
      Math.floor(position.y - PLAYER_FEET_OFFSET),
      Math.floor(position.z),
      {
        getVoxel: (x, y, z) => world.getVoxel(x, y, z),
        getFluidLevel: (x, y, z) => world.getFluidCell(x, y, z)?.level ?? null,
      },
    );
    const macroDirection = macroAt(world.seed, position.x, position.z, world.generatorVersion).hydrology.direction;
    environment.setWaterFlowDirection(flow[0] || flow[1] ? flow : macroDirection);
  }

  updateImmersion(seconds: number, medium: WaterImmersionSnapshot | undefined, environment: WorldEnvironment | null) {
    environment?.setUnderwaterBlend(this.visual.update(seconds, medium?.cameraSubmerged ?? false));
  }

  destroy() {
    this.visual.destroy();
  }
}
