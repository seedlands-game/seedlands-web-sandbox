import * as pc from 'playcanvas';
import { SURFACE_LIGHTING_MAX_RADIANCE, type LinearRgb, type SurfaceLightingMaterialAdapter } from './surface-lighting';

const RECEIVED_LIGHTING_CHUNK = `
uniform vec3 uSurfaceReceivedLighting;
void getLightMap() {
    dLightmap = uSurfaceReceivedLighting;
}
`;

/** Owns the feature lightmap shared by materials prepared by this instance. */
export class PlayCanvasSurfaceLightingResources {
  private readonly adapters = new WeakMap<pc.StandardMaterial, SurfaceLightingMaterialAdapter>();
  private featureLightMap: pc.Texture | null = null;
  private disposed = false;

  constructor(private readonly device: pc.GraphicsDevice) {}

  prepare(material: pc.StandardMaterial): SurfaceLightingMaterialAdapter {
    this.assertActive();
    if (!(material instanceof pc.StandardMaterial)) throw new TypeError('A PlayCanvas StandardMaterial is required.');
    const existing = this.adapters.get(material);
    if (existing) return existing;

    const uniform = new Float32Array(3);
    const adapter: SurfaceLightingMaterialAdapter = Object.freeze({
      apply: (channels) => {
        this.assertActive();
        const received = channels?.receivedLighting;
        if (!received || received.length !== 3) throw new TypeError('Received lighting must contain three channels.');
        for (let index = 0; index < 3; index++) {
          const value = received[index];
          if (
            typeof value !== 'number' ||
            !Number.isFinite(value) ||
            value < 0 ||
            value > SURFACE_LIGHTING_MAX_RADIANCE * 2
          )
            throw new RangeError('Received lighting channels must be finite and within 0..32.');
        }
        uniform.set(received);
        material.setParameter('uSurfaceReceivedLighting', uniform);
      },
    });

    material.lightMap = this.getFeatureLightMap();
    material.lightMapUv = 0;
    material.useLighting = false;
    material.useSkybox = false;
    material.shaderChunksVersion = '2.8';
    material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set('lightmapPS', RECEIVED_LIGHTING_CHUNK);
    material.setParameter('uSurfaceReceivedLighting', uniform);
    material.update();
    this.adapters.set(material, adapter);
    return adapter;
  }

  selfEmission(material: pc.StandardMaterial): LinearRgb {
    this.assertActive();
    if (!(material instanceof pc.StandardMaterial)) throw new TypeError('A PlayCanvas StandardMaterial is required.');
    const color = material.emissive.clone().linear();
    const intensity = material.emissiveIntensity;
    if (!Number.isFinite(intensity) || intensity < 0 || intensity > SURFACE_LIGHTING_MAX_RADIANCE)
      throw new RangeError('Emissive intensity must be finite and within 0..16.');
    const result = [color.r * intensity, color.g * intensity, color.b * intensity] as const;
    if (result.some((channel) => !Number.isFinite(channel) || channel < 0 || channel > SURFACE_LIGHTING_MAX_RADIANCE))
      throw new RangeError('Self emission channels must be finite and within 0..16.');
    return result;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.featureLightMap?.destroy();
    this.featureLightMap = null;
  }

  private getFeatureLightMap(): pc.Texture {
    if (!this.featureLightMap) {
      this.featureLightMap = new pc.Texture(this.device, {
        name: 'surface-received-lighting-feature',
        width: 1,
        height: 1,
        format: pc.PIXELFORMAT_RGBA8,
        mipmaps: false,
        minFilter: pc.FILTER_NEAREST,
        magFilter: pc.FILTER_NEAREST,
        addressU: pc.ADDRESS_CLAMP_TO_EDGE,
        addressV: pc.ADDRESS_CLAMP_TO_EDGE,
        levels: [new Uint8Array([255, 255, 255, 255])],
      });
    }
    return this.featureLightMap;
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Surface lighting resources have been disposed.');
  }
}
