import { describe, expect, it, vi } from 'vitest';
import * as pc from 'playcanvas';
import { applySurfaceLightingToMaterial, createSurfaceLightingSample } from '../../../src/app/scene/surface-lighting';
import { PlayCanvasSurfaceLightingResources } from '../../../src/app/scene/playcanvas-surface-lighting';

function makeResources(): PlayCanvasSurfaceLightingResources {
  return new PlayCanvasSurfaceLightingResources(new pc.NullGraphicsDevice({}));
}

describe('PlayCanvas surface lighting adapter', () => {
  it('applies received lighting while retaining independent self emission', () => {
    const resources = makeResources();
    const material = new pc.StandardMaterial();
    material.emissive = new pc.Color(0.5, 0.25, 0.125);
    material.emissiveIntensity = 2;
    const adapter = resources.prepare(material);
    expect(resources.prepare(material)).toBe(adapter);

    const result = applySurfaceLightingToMaterial(
      adapter,
      createSurfaceLightingSample({
        skyVisibility: 0.5,
        skyRadiance: [2, 1, 0],
        blockIrradiance: [0.25, 0.5, 1],
        selfEmission: resources.selfEmission(material),
      }),
    );
    expect(result.receivedLighting).toEqual([1.25, 1, 1]);
    expect(result.selfEmission[0]).toBeCloseTo(0.435275, 5);
    expect(result.selfEmission[1]).toBeCloseTo(0.094732, 5);
    expect(result.selfEmission[2]).toBeCloseTo(0.020617, 5);
    expect(material.emissiveIntensity).toBe(2);
    expect((material.getParameter('uSurfaceReceivedLighting') as { data: Float32Array }).data).toBeInstanceOf(
      Float32Array,
    );
    expect(Array.from((material.getParameter('uSurfaceReceivedLighting') as { data: Float32Array }).data)).toEqual([
      1.25, 1, 1,
    ]);
    expect(material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).get('lightmapPS')).toContain(
      'dLightmap = uSurfaceReceivedLighting',
    );
    expect(material.useLighting).toBe(false);
    expect(material.useSkybox).toBe(false);
    resources.dispose();
  });

  it('fails dark for unknown channels and shares one owned feature map across materials', () => {
    const resources = makeResources();
    const first = new pc.StandardMaterial();
    const second = new pc.StandardMaterial();
    resources.prepare(first);
    resources.prepare(second);
    expect(first.lightMap).toBe(second.lightMap);
    const channels = applySurfaceLightingToMaterial(
      resources.prepare(first),
      createSurfaceLightingSample({
        skyVisibility: null,
        skyRadiance: null,
        blockIrradiance: null,
        selfEmission: [0, 0, 0],
      }),
    );
    expect(channels.receivedLighting).toEqual([0, 0, 0]);
    expect(Array.from((first.getParameter('uSurfaceReceivedLighting') as { data: Float32Array }).data)).toEqual([
      0, 0, 0,
    ]);
    resources.dispose();
  });

  it('destroys only its feature map once and rejects use after disposal', () => {
    const resources = makeResources();
    const borrowed = new pc.Texture(new pc.NullGraphicsDevice({}), { width: 1, height: 1 });
    const material = new pc.StandardMaterial();
    material.diffuseMap = borrowed;
    material.emissiveMap = borrowed;
    const adapter = resources.prepare(material);
    const borrowedDestroy = vi.spyOn(borrowed, 'destroy');
    const owned = material.lightMap!;
    let destroyed = 0;
    const destroy = owned.destroy.bind(owned);
    owned.destroy = () => {
      destroyed++;
      destroy();
    };
    resources.dispose();
    resources.dispose();
    expect(destroyed).toBe(1);
    expect(borrowedDestroy).not.toHaveBeenCalled();
    expect(material.emissiveMap).toBe(borrowed);
    expect(() => resources.prepare(new pc.StandardMaterial())).toThrow(/disposed/);
    expect(() => resources.selfEmission(material)).toThrow(/disposed/);
    expect(() => adapter.apply({ receivedLighting: [1, 1, 1], selfEmission: [0, 0, 0] })).toThrow(/disposed/);
    borrowed.destroy();
  });
});
