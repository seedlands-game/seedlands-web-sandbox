import * as pc from 'playcanvas';
import { CHUNK_SIZE } from '@seedlands/stdlib/world/voxel';
import type { SkyVisibilityVolume } from '../scene/sky-visibility-volume';
import type { PlayCanvasChunkResource } from './playcanvas-chunk-adapter';

export const createChunkSkyTexture = (device: pc.GraphicsDevice, key: string) =>
  new pc.Texture(device, {
    name: `voxel-sky-visibility-${key}`,
    width: CHUNK_SIZE,
    height: CHUNK_SIZE + 1,
    depth: CHUNK_SIZE,
    volume: true,
    format: pc.PIXELFORMAT_R8,
    mipmaps: false,
    minFilter: pc.FILTER_NEAREST,
    magFilter: pc.FILTER_NEAREST,
    addressU: pc.ADDRESS_CLAMP_TO_EDGE,
    addressV: pc.ADDRESS_CLAMP_TO_EDGE,
    addressW: pc.ADDRESS_CLAMP_TO_EDGE,
    levels: [new Uint8Array(CHUNK_SIZE ** 2 * (CHUNK_SIZE + 1))],
  });

export const bindChunkSky = (instance: pc.MeshInstance, resource: PlayCanvasChunkResource): void => {
  if (!resource.skyTexture) return;
  instance.setParameter('texture_skyVisibility', resource.skyTexture);
  instance.setParameter('uSkyVisibilityOrigin', resource.skyOrigin!);
  instance.setParameter('uSkyVisibilitySize', CHUNK_SIZE);
  instance.setParameter('uSkyVisibilityReady', resource.skyReady ? 1 : 0);
};

export const invalidateChunkSky = (resource: PlayCanvasChunkResource): void => {
  if (!resource.skyTexture) return;
  (resource.skyTexture.lock() as Uint8Array).fill(0);
  resource.skyTexture.unlock();
  resource.skyReady = false;
  for (const instance of resource.instances) bindChunkSky(instance, resource);
  if (resource.waterTransition) bindChunkSky(resource.waterTransition.instance, resource);
};

export const applyChunkSky = (resource: PlayCanvasChunkResource, volume: SkyVisibilityVolume): void => {
  if (!resource.skyTexture || volume.size !== CHUNK_SIZE || volume.visibility.length !== CHUNK_SIZE ** 3)
    throw new TypeError('Sky visibility R8 volume is invalid.');
  if (volume.upperBoundaryVisibility && volume.upperBoundaryVisibility.length !== CHUNK_SIZE ** 2)
    throw new TypeError('Sky upper boundary is invalid.');
  const pixels = resource.skyTexture.lock() as Uint8Array;
  pixels.fill(0);
  for (let z = 0; z < CHUNK_SIZE; z++) {
    const base = z * CHUNK_SIZE * (CHUNK_SIZE + 1);
    pixels.set(volume.visibility.subarray(z * CHUNK_SIZE ** 2, (z + 1) * CHUNK_SIZE ** 2), base);
    if (volume.upperBoundaryVisibility)
      pixels.set(volume.upperBoundaryVisibility.subarray(z * CHUNK_SIZE, (z + 1) * CHUNK_SIZE), base + CHUNK_SIZE ** 2);
  }
  resource.skyTexture.unlock();
  resource.skyOrigin = new Float32Array(volume.origin);
  resource.skyReady = true;
  for (const instance of resource.instances) bindChunkSky(instance, resource);
  if (resource.waterTransition) bindChunkSky(resource.waterTransition.instance, resource);
};
