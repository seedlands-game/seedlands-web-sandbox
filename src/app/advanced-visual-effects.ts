import * as pc from 'playcanvas';
import { Voxel } from '../world/voxel';
import type { World } from './world-runtime';
import type { VoxelMaterials } from './voxel-materials';
import type { LightingQualityBudget } from './advanced-lighting-budget';
import { selectNearestLanterns } from './advanced-lighting-budget';
import { StylizedPostProcessing } from './stylized-post-effect';
import { reflectionPlaneAboveCamera, waterReflectionSurfaceY } from './water-reflection-plane';

export type VisualEffectsSnapshot = {
  activeLocalLights: number;
  shadowedLocalLights: number;
  localLightLimit: number;
  localShadowLimit: number;
  sunShadows: boolean;
  sunShadowResolution: number;
  reflectionEnabled: boolean;
  reflectionActive: boolean;
  reflectionResolution: number;
  reflectionFrameInterval: number;
  reflectionRenderCount: number;
  waterPlaneY: number | null;
  postProcessing: boolean;
};

class PlanarWaterReflection {
  private readonly texture: pc.Texture;
  private readonly target: pc.RenderTarget;
  private readonly cameraEntity: pc.Entity;
  private readonly reflectionStrength: number;
  private frame = 0;
  renderCount = 0;
  active = false;

  constructor(
    app: pc.Application,
    private readonly waterMaterials: readonly pc.StandardMaterial[],
    resolution: number,
    private readonly frameInterval: number,
  ) {
    this.reflectionStrength = resolution >= 256 ? 0.68 : 0.44;
    this.texture = new pc.Texture(app.graphicsDevice, {
      name: 'planar-water-reflection',
      width: resolution,
      height: resolution,
      format: pc.PIXELFORMAT_RGBA8,
      mipmaps: false,
      minFilter: pc.FILTER_LINEAR,
      magFilter: pc.FILTER_LINEAR,
      addressU: pc.ADDRESS_CLAMP_TO_EDGE,
      addressV: pc.ADDRESS_CLAMP_TO_EDGE,
    });
    this.target = new pc.RenderTarget({
      name: 'planar-water-reflection-target',
      colorBuffer: this.texture,
      depth: true,
      flipY: true,
    });
    this.cameraEntity = new pc.Entity('Water Reflection Camera');
    this.cameraEntity.addComponent('camera', {
      clearColor: new pc.Color(0.16, 0.32, 0.45, 1),
      fov: 72,
      nearClip: 0.1,
      farClip: 150,
      priority: -10,
      renderTarget: this.target,
      layers: [pc.LAYERID_WORLD, pc.LAYERID_SKYBOX],
    });
    this.cameraEntity.enabled = false;
    app.root.addChild(this.cameraEntity);
    for (const material of waterMaterials) {
      material.setParameter('texture_planarReflection', this.texture);
      material.setParameter('uReflectionWaterPlaneY', 0);
      material.setParameter('uReflectionStrength', 0);
    }
  }

  update(source: pc.Entity, waterPlaneY: number | null) {
    this.frame += 1;
    const position = source.getPosition();
    const activeWaterPlaneY = reflectionPlaneAboveCamera(waterPlaneY, position.y);
    const shouldRender = activeWaterPlaneY !== null && this.frame % this.frameInterval === 0;
    this.active = activeWaterPlaneY !== null;
    for (const material of this.waterMaterials) {
      material.setParameter('uReflectionWaterPlaneY', activeWaterPlaneY ?? 0);
      material.setParameter('uReflectionStrength', activeWaterPlaneY === null ? 0 : this.reflectionStrength);
    }
    this.cameraEntity.enabled = shouldRender;
    const sourceCamera = source.camera;
    const reflectionCamera = this.cameraEntity.camera;
    if (!shouldRender || !sourceCamera || !reflectionCamera || activeWaterPlaneY === null) return;
    reflectionCamera.fov = sourceCamera.fov;
    reflectionCamera.farClip = sourceCamera.farClip;
    const forward = source.forward;
    const up = source.up;
    const reflectedPosition = new pc.Vec3(position.x, activeWaterPlaneY * 2 - position.y, position.z);
    const reflectedTarget = new pc.Vec3(
      position.x + forward.x,
      activeWaterPlaneY * 2 - (position.y + forward.y),
      position.z + forward.z,
    );
    const reflectedUp = new pc.Vec3(up.x, -up.y, up.z);
    this.cameraEntity.setPosition(reflectedPosition);
    this.cameraEntity.lookAt(reflectedTarget, reflectedUp);
    this.renderCount += 1;
  }

  setViewport(width: number, height: number) {
    for (const material of this.waterMaterials)
      material.setParameter('uReflectionViewport', new Float32Array([Math.max(1, width), Math.max(1, height)]));
  }

  destroy() {
    this.cameraEntity.destroy();
    this.target.destroy();
    this.texture.destroy();
  }
}

export class AdvancedVisualEffects {
  private readonly localLights: pc.Entity[];
  private readonly reflection: PlanarWaterReflection | null;
  private readonly postProcessing: StylizedPostProcessing | null;
  private scanElapsed = Number.POSITIVE_INFINITY;
  private activeLocalLights = 0;
  private waterPlaneY: number | null = null;

  constructor(
    private readonly app: pc.Application,
    private readonly camera: pc.Entity,
    private readonly world: World,
    private readonly budget: LightingQualityBudget,
    materials: VoxelMaterials,
  ) {
    this.localLights = Array.from({ length: budget.maxLocalLights }, (_, index) => {
      const castsShadow = index < budget.maxShadowedLocalLights;
      const entity = new pc.Entity(`Lantern Light ${index + 1}`);
      entity.addComponent('light', {
        type: 'omni',
        color: new pc.Color(1, 0.49, 0.16),
        intensity: 1.1,
        range: 8,
        castShadows: castsShadow,
        shadowResolution: castsShadow ? budget.localShadowResolution : 128,
        shadowType: pc.SHADOW_PCF1_32F,
        shadowUpdateMode: castsShadow ? pc.SHADOWUPDATE_REALTIME : pc.SHADOWUPDATE_NONE,
        shadowBias: 0.18,
        normalOffsetBias: 0.08,
      });
      entity.enabled = false;
      app.root.addChild(entity);
      return entity;
    });
    this.reflection =
      budget.reflectionResolution > 0
        ? new PlanarWaterReflection(app, materials.water, budget.reflectionResolution, budget.reflectionFrameInterval)
        : null;
    this.postProcessing =
      budget.postProcessing && camera.camera
        ? new StylizedPostProcessing(camera.camera, app.graphicsDevice, budget.colorGradeStrength)
        : null;
    if (camera.camera)
      camera.camera.toneMapping =
        budget.colorGradeStrength >= 0.3
          ? pc.TONEMAP_ACES
          : budget.postProcessing
            ? pc.TONEMAP_NEUTRAL
            : pc.TONEMAP_LINEAR;
  }

  update(dt: number) {
    this.scanElapsed += dt;
    if (this.scanElapsed >= this.budget.scanIntervalSeconds) {
      this.scanElapsed = 0;
      this.scanNearbyVoxels();
    }
    this.reflection?.setViewport(this.app.graphicsDevice.width, this.app.graphicsDevice.height);
    this.reflection?.update(this.camera, this.waterPlaneY);
  }

  get snapshot(): VisualEffectsSnapshot {
    return {
      activeLocalLights: this.activeLocalLights,
      shadowedLocalLights: Math.min(this.activeLocalLights, this.budget.maxShadowedLocalLights),
      localLightLimit: this.budget.maxLocalLights,
      localShadowLimit: this.budget.maxShadowedLocalLights,
      sunShadows: this.budget.sunShadowResolution > 0,
      sunShadowResolution: this.budget.sunShadowResolution,
      reflectionEnabled: this.reflection !== null,
      reflectionActive: this.reflection?.active ?? false,
      reflectionResolution: this.budget.reflectionResolution,
      reflectionFrameInterval: this.budget.reflectionFrameInterval,
      reflectionRenderCount: this.reflection?.renderCount ?? 0,
      waterPlaneY: this.waterPlaneY,
      postProcessing: this.postProcessing !== null,
    };
  }

  destroy() {
    this.localLights.forEach((light) => light.destroy());
    this.reflection?.destroy();
    this.postProcessing?.destroy();
  }

  private scanNearbyVoxels() {
    const position = this.camera.getPosition();
    const centerX = Math.floor(position.x);
    const centerY = Math.floor(position.y);
    const centerZ = Math.floor(position.z);
    const radius = Math.max(this.budget.horizontalScanRadius, this.budget.reflectionSearchRadius);
    const verticalRadius = this.budget.verticalScanRadius;
    const lanterns: [number, number, number][] = [];
    let nearestWater: { surfaceY: number; distance: number } | null = null;
    for (let y = Math.max(0, centerY - verticalRadius); y <= centerY + verticalRadius; y += 1)
      for (let z = centerZ - radius; z <= centerZ + radius; z += 1)
        for (let x = centerX - radius; x <= centerX + radius; x += 1) {
          const horizontalDistance = (x + 0.5 - position.x) ** 2 + (z + 0.5 - position.z) ** 2;
          if (horizontalDistance > radius ** 2) continue;
          const voxel = this.world.getVoxel(x, y, z);
          if (voxel === Voxel.Lantern) lanterns.push([x, y, z]);
          if (
            this.reflection &&
            horizontalDistance <= this.budget.reflectionSearchRadius ** 2 &&
            voxel === Voxel.Water &&
            this.world.getVoxel(x, y + 1, z) !== Voxel.Water
          ) {
            const surfaceY = waterReflectionSurfaceY(y, this.world.server.getFluidCell(x, y, z)?.level ?? 8, false);
            if (surfaceY === null) continue;
            const distance = horizontalDistance + (surfaceY - position.y) ** 2;
            if (!nearestWater || distance < nearestWater.distance) nearestWater = { surfaceY, distance };
          }
        }
    const selected = selectNearestLanterns([position.x, position.y, position.z], lanterns, {
      horizontalRadius: this.budget.horizontalScanRadius,
      verticalRadius,
      limit: this.budget.maxLocalLights,
    });
    this.activeLocalLights = selected.length;
    this.localLights.forEach((light, index) => {
      const voxel = selected[index];
      light.enabled = voxel !== undefined;
      if (voxel) light.setPosition(voxel[0] + 0.5, voxel[1] + 0.62, voxel[2] + 0.5);
    });
    this.waterPlaneY = nearestWater?.surfaceY ?? null;
  }
}
