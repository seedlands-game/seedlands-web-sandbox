import * as pc from 'playcanvas';
import { MATERIAL_LAYER_COUNT } from './voxel-render-pipeline';
import type { VoxelMaterials } from './voxel-materials';
import { BLOCK_LIGHT_VOLUME_SIZE, blockLightOriginForChunk } from './block-light-volume';
import {
  applyChunkBlockLightVolume,
  invalidateChunkBlockLightVolume,
  type PlayCanvasChunkResource,
} from '../world/playcanvas-chunk-adapter';
import { createChunkSkyTexture, applyChunkSky, invalidateChunkSky } from '../world/playcanvas-sky-visibility';
import { SKY_VISIBILITY_VOLUME_BYTES } from './sky-visibility-volume';

export type ReceivedLightingGpuPixel = Readonly<{
  category: 'opaque' | 'transparent';
  name: string;
  rgba: readonly number[];
}>;

const cases = [
  { name: 'sky-only', sky: 255, block: 0, skyReady: true, blockReady: true },
  { name: 'block-only', sky: 0, block: 15, skyReady: true, blockReady: true },
  { name: 'combined', sky: 255, block: 15, skyReady: true, blockReady: true },
  { name: 'unknown-sky', sky: 255, block: 15, skyReady: false, blockReady: true },
  { name: 'unknown-block', sky: 255, block: 15, skyReady: true, blockReady: false },
  { name: 'invalidated-sky', sky: 255, block: 15, skyReady: true, blockReady: true },
  { name: 'invalidated-block', sky: 255, block: 15, skyReady: true, blockReady: true },
  { name: 'self-only', sky: 0, block: 0, skyReady: true, blockReady: true },
  { name: 'self-unknown', sky: 255, block: 15, skyReady: false, blockReady: false },
] as const;

/** Production shader and R8 lifecycle observation; no Authority writes or input. */
export function receivedLightingGpuProbe(
  app: pc.Application,
  materials: VoxelMaterials,
): readonly ReceivedLightingGpuPixel[] {
  const device = app.graphicsDevice;
  if (!(device instanceof pc.WebglGraphicsDevice)) throw new Error('Received-lighting pixels require WebGL2.');
  const layer = new pc.Layer({ name: 'Received Lighting Pixel Probe' });
  const color = new pc.Texture(device, { width: 4, height: 4, format: pc.PIXELFORMAT_RGBA8, mipmaps: false });
  const target = new pc.RenderTarget({ colorBuffer: color, depth: true });
  const camera = new pc.Entity('Received Lighting Pixel Camera');
  camera.addComponent('camera', {
    projection: pc.PROJECTION_ORTHOGRAPHIC,
    orthoHeight: 0.5,
    nearClip: 0.1,
    farClip: 10,
    clearColor: pc.Color.BLACK,
    gammaCorrection: pc.GAMMA_NONE,
    toneMapping: pc.TONEMAP_NONE,
    exposure: 1,
    priority: 1000,
    renderTarget: target,
    layers: [layer.id],
  });
  camera.setPosition(0.5, 2, 0.5);
  camera.lookAt(0.5, 0.1, 0.5, 0, 0, -1);
  const white = document.createElement('canvas');
  white.width = white.height = 1;
  const context = white.getContext('2d')!;
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, 1, 1);
  const albedo = new pc.Texture(device, {
    width: 1,
    height: 1,
    arrayLength: MATERIAL_LAYER_COUNT,
    format: pc.PIXELFORMAT_RGBA8,
    mipmaps: false,
    levels: [Array.from({ length: MATERIAL_LAYER_COUNT }, () => white)] as unknown as HTMLCanvasElement[],
  });
  const pixels: ReceivedLightingGpuPixel[] = [];
  app.scene.layers.pushOpaque(layer);
  app.root.addChild(camera);
  try {
    for (const category of ['opaque', 'transparent'] as const) {
      const source = materials.categoryMaterials.get(category);
      if (!source) throw new Error(`Missing production ${category} material.`);
      const material = source.clone();
      for (const [name, parameter] of Object.entries(source.parameters)) {
        if (!parameter || typeof parameter !== 'object' || !('data' in parameter))
          throw new TypeError(`Invalid production material parameter ${name}.`);
        const data = parameter.data;
        if (
          typeof data !== 'number' &&
          !(Array.isArray(data) && data.every((value) => typeof value === 'number')) &&
          !ArrayBuffer.isView(data) &&
          !(data instanceof pc.Texture) &&
          !(data instanceof pc.StorageBuffer)
        )
          throw new TypeError(`Unsupported production material parameter ${name}.`);
        material.setParameter(name, data);
      }
      material.name = `received-lighting-probe-${category}`;
      material.diffuse = pc.Color.WHITE;
      material.emissive = pc.Color.BLACK;
      material.opacity = 1;
      material.blendType = pc.BLEND_NONE;
      material.cull = pc.CULLFACE_NONE;
      material.useFog = false;
      material.setParameter('texture_voxelArray', albedo);
      material.setParameter('uSkyRadiance', new Float32Array([0.25, 0.25, 0.25]));
      material.setParameter('uBlockLightTint', new Float32Array([0.25, 0.25, 0.25]));
      material.setParameter('uVoxelSurface[0]', new Float32Array(MATERIAL_LAYER_COUNT * 2));
      material.setParameter('uVoxelEmissionThreshold[0]', new Float32Array(MATERIAL_LAYER_COUNT));
      material.setParameter('uVoxelEmissionRedDominance[0]', new Float32Array(MATERIAL_LAYER_COUNT));
      material.setParameter('uReflectionStrength', 0);
      material.update();
      const mesh = new pc.Mesh(device);
      mesh.setPositions([0, 0.1, 0, 1, 0.1, 0, 1, 0.1, 1, 0, 0.1, 1]);
      mesh.setNormals([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
      mesh.setUvs(0, [0, 0, 1, 0, 1, 1, 0, 1]);
      mesh.setColors([1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0, 1, 1, 1, 0]);
      mesh.setIndices([0, 2, 1, 0, 3, 2]);
      mesh.update(pc.PRIMITIVE_TRIANGLES);
      const node = new pc.Entity('Received Lighting Pixel Surface');
      app.root.addChild(node);
      const instance = new pc.MeshInstance(mesh, material, node);
      instance.mask = 0;
      const resource: PlayCanvasChunkResource = {
        entity: node,
        categoryEntities: new Map(),
        meshes: [mesh],
        instances: [instance],
        waterInstances: [],
        waterParts: [],
        waterTransition: null,
        transitionCancel: null,
        skyTexture: createChunkSkyTexture(device, 'pixel-probe'),
        blockLightTexture: new pc.Texture(device, {
          width: BLOCK_LIGHT_VOLUME_SIZE,
          height: BLOCK_LIGHT_VOLUME_SIZE,
          depth: BLOCK_LIGHT_VOLUME_SIZE,
          volume: true,
          format: pc.PIXELFORMAT_R8,
          mipmaps: false,
          minFilter: pc.FILTER_NEAREST,
          magFilter: pc.FILTER_NEAREST,
          levels: [new Uint8Array(BLOCK_LIGHT_VOLUME_SIZE ** 3)],
        }),
      };
      layer.addMeshInstances([instance]);
      try {
        for (const entry of cases) {
          const self = entry.name.startsWith('self-');
          const emission = new Float32Array(MATERIAL_LAYER_COUNT * 4);
          if (self) for (let index = 0; index < MATERIAL_LAYER_COUNT; index++) emission.set([1, 1, 1, 0.25], index * 4);
          material.setParameter('uVoxelEmission[0]', emission);
          material.setParameter('material_emissive', new Float32Array(self ? [0.25, 0.25, 0.25] : [0, 0, 0]));
          applyChunkSky(resource, {
            chunk: [0, 0, 0],
            origin: [0, 0, 0],
            size: 32,
            sourceRevision: 'synthetic-probe',
            visibility: new Uint8Array(SKY_VISIBILITY_VOLUME_BYTES).fill(entry.sky),
          });
          applyChunkBlockLightVolume(resource, {
            origin: blockLightOriginForChunk(0, 0, 0),
            size: BLOCK_LIGHT_VOLUME_SIZE,
            levels: new Uint8Array(BLOCK_LIGHT_VOLUME_SIZE ** 3).fill(entry.block),
          });
          instance.setParameter('uSkyVisibilityReady', entry.skyReady ? 1 : 0);
          instance.setParameter('uBlockLightReady', entry.blockReady ? 1 : 0);
          if (entry.name === 'invalidated-sky') invalidateChunkSky(resource);
          if (entry.name === 'invalidated-block') invalidateChunkBlockLightVolume(resource);
          app.render();
          const previous = device.renderTarget;
          const rgba = new Uint8Array(4);
          try {
            device.setRenderTarget(target);
            device.updateBegin();
            device.readPixels(2, 2, 1, 1, rgba);
            device.updateEnd();
          } finally {
            device.setRenderTarget(previous);
          }
          pixels.push(Object.freeze({ category, name: entry.name, rgba: Object.freeze([...rgba]) }));
        }
      } finally {
        layer.removeMeshInstances([instance]);
        instance.destroy();
        node.destroy();
        resource.skyTexture?.destroy();
        resource.blockLightTexture?.destroy();
        material.destroy();
      }
    }
    return Object.freeze(pixels);
  } finally {
    app.scene.layers.remove(layer);
    camera.destroy();
    target.destroy();
    color.destroy();
    albedo.destroy();
  }
}
