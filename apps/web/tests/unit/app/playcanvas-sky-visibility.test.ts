import * as pc from 'playcanvas';
import { describe, expect, it, vi } from 'vitest';
import {
  applyChunkSky,
  bindChunkSky,
  createChunkSkyTexture,
  invalidateChunkSky,
} from '../../../src/app/world/playcanvas-sky-visibility';
import type { PlayCanvasChunkResource } from '../../../src/app/world/playcanvas-chunk-adapter';

describe('actual PlayCanvas R8 CPU resource (Null device, not GPU pixel evidence)', () => {
  it('uploads 32 cubed visibility and keeps material and water transition bindings on the same texture', () => {
    const device = new pc.NullGraphicsDevice({ width: 8, height: 8 } as HTMLCanvasElement);
    const texture = createChunkSkyTexture(device, '0,0,0');
    const mesh = new pc.Mesh(device);
    const material = new pc.StandardMaterial();
    const instance = new pc.MeshInstance(mesh, material, new pc.Entity());
    const water = new pc.MeshInstance(mesh, material, new pc.Entity());
    const resource = {
      skyTexture: texture,
      skyOrigin: new Float32Array(3),
      instances: [instance],
      waterTransition: { instance: water },
    } as unknown as PlayCanvasChunkResource;
    bindChunkSky(instance, resource);
    expect(texture.format).toBe(pc.PIXELFORMAT_R8);
    expect(texture.volume).toBe(true);
    applyChunkSky(resource, {
      chunk: [0, 0, 0],
      origin: [0, 0, 0],
      size: 32,
      sourceRevision: 'current',
      visibility: new Uint8Array(32768).fill(255),
    });
    expect(instance.getParameter('texture_skyVisibility')).toMatchObject({ data: texture });
    expect(water.getParameter('texture_skyVisibility')).toMatchObject({ data: texture });
    expect((texture.lock() as Uint8Array).every((value) => value === 255)).toBe(true);
    texture.unlock();
    invalidateChunkSky(resource);
    expect((texture.lock() as Uint8Array).every((value) => value === 0)).toBe(true);
    texture.unlock();
    const destroyed = vi.spyOn(texture, 'destroy');
    texture.destroy();
    expect(destroyed).toHaveBeenCalledTimes(1);
    instance.destroy();
    water.destroy();
    material.destroy();
    device.destroy();
  });
});
