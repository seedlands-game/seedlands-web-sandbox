import * as pc from 'playcanvas';
import { CHUNK_SIZE } from '@seedlands/stdlib/world/voxel';
import type { PackPresentationCatalog } from '../../client/presentation/pack-presentation-loader';
import { buildCropStageGeometry } from '../../client/presentation/crop-stage-geometry';
import { voxelReceivedLightGlsl } from '../shaders/voxel-received-light-chunk';
import type { PlayCanvasChunkResource } from './playcanvas-chunk-adapter';
import type { LinearRgb } from '../scene/surface-lighting';
import type { CropStageAdapter, CropStageBatch } from './crop-stage-presenter';

export type CropRenderBatchSnapshot = Readonly<{
  chunkKey: string;
  presentationId: string;
  stage: number;
  positions: readonly (readonly [number, number, number])[];
  vertexCount: number;
  indexCount: number;
  enabled: boolean;
  lightingBound: boolean;
}>;

export type CropRenderResource = Readonly<{
  batch: Readonly<Pick<CropStageBatch, 'presentationId' | 'stage' | 'positions'>>;
  chunkKey: string;
  entity: pc.Entity;
  mesh: pc.Mesh;
  instance: pc.MeshInstance;
}>;
type ChunkLighting = Pick<
  PlayCanvasChunkResource,
  | 'blockLightTexture'
  | 'blockLightOrigin'
  | 'blockLightSize'
  | 'blockLightReady'
  | 'skyTexture'
  | 'skyOrigin'
  | 'skyReady'
  | 'lightingListeners'
>;
export type PlayCanvasCropPresentation = CropStageAdapter<CropRenderResource> &
  Readonly<{
    definitions: NonNullable<PackPresentationCatalog['crops']>;
    lightingMaterials: readonly pc.StandardMaterial[];
    setLightingFrame(sky: LinearRgb, tint: LinearRgb): void;
    bindChunkLight(key: string, lighting: ChunkLighting | undefined): void;
    snapshot(): readonly CropRenderBatchSnapshot[];
    dispose(): void;
  }>;

/** Owns disposable GPU assets only; terrain light bricks are borrowed, never destroyed here. */
export async function createPlayCanvasCropPresentation(
  app: pc.Application,
  catalog: PackPresentationCatalog,
): Promise<PlayCanvasCropPresentation> {
  const definitions = catalog.crops ?? {};
  const materials = new Map<string, pc.StandardMaterial>();
  const textures: pc.Texture[] = [];
  const live = new Map<string, Set<CropRenderResource>>();
  const lightingReleases = new WeakMap<CropRenderResource, () => void>();
  let disposed = false;
  const destroy = (resource: CropRenderResource) => {
    const group = live.get(resource.chunkKey);
    if (!group?.delete(resource)) return;
    if (!group.size) live.delete(resource.chunkKey);
    lightingReleases.get(resource)?.();
    lightingReleases.delete(resource);
    resource.entity.destroy();
    resource.mesh.destroy();
  };
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    for (const group of [...live.values()]) for (const resource of [...group]) destroy(resource);
    for (const material of materials.values()) material.destroy();
    materials.clear();
    for (const texture of textures) texture.destroy();
    textures.length = 0;
  };
  try {
    for (const crop of Object.values(definitions)) {
      for (const [stage, definition] of crop.stages.entries()) {
        const url = catalog.assetUrls[definition.texture];
        if (!url) throw new Error(`Crop texture is not resolved: ${definition.texture}`);
        const image = new Image();
        image.src = url;
        await image.decode();
        const texture = new pc.Texture(app.graphicsDevice, {
          name: `${crop.id}:${stage}`,
          width: image.naturalWidth,
          height: image.naturalHeight,
          mipmaps: false,
          minFilter: pc.FILTER_NEAREST,
          magFilter: pc.FILTER_NEAREST,
          addressU: pc.ADDRESS_CLAMP_TO_EDGE,
          addressV: pc.ADDRESS_CLAMP_TO_EDGE,
          srgb: true,
          flipY: false,
        });
        textures.push(texture);
        texture.setSource(image);
        const material = new pc.StandardMaterial();
        materials.set(JSON.stringify([crop.id, stage]), material);
        material.name = `crop-${crop.id}-${stage}`;
        material.diffuseMap = texture;
        material.opacityMap = texture;
        material.opacityMapChannel = 'a';
        material.alphaTest = 0.5;
        material.cull = pc.CULLFACE_NONE;
        material.twoSidedLighting = true;
        material.specular.set(0, 0, 0);
        material.emissive.set(0, 0, 0);
        material.useLighting = false;
        material.useSkybox = false;
        material.useMetalness = true;
        material.shaderChunksVersion = '2.8';
        material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set('lightmapPS', voxelReceivedLightGlsl);
        material.update();
      }
    }
    const feature = new pc.Texture(app.graphicsDevice, {
      name: 'crop-received-light-feature',
      width: 1,
      height: 1,
      format: pc.PIXELFORMAT_RGBA8,
      mipmaps: false,
      levels: [new Uint8Array(4)],
    });
    textures.push(feature);
    for (const material of materials.values()) {
      material.lightMap = feature;
      material.lightMapUv = 0;
      material.update();
    }
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    definitions,
    lightingMaterials: Object.freeze([...materials.values()]),
    setLightingFrame(sky, tint) {
      for (const material of materials.values()) {
        material.setParameter('uSkyRadiance', new Float32Array(sky));
        material.setParameter('uBlockLightTint', new Float32Array(tint));
      }
    },
    create(batch: CropStageBatch) {
      if (disposed) throw new Error('Crop presentation has been disposed.');
      const material = materials.get(JSON.stringify([batch.presentationId, batch.stage]));
      if (!material) throw new Error('Crop presentation material is unresolved.');
      const origin = [batch.cx * CHUNK_SIZE, batch.cy * CHUNK_SIZE, batch.cz * CHUNK_SIZE] as const;
      const data = buildCropStageGeometry({ positions: batch.positions, origin, ...batch.definition });
      const mesh = new pc.Mesh(app.graphicsDevice);
      let entity: pc.Entity | undefined, instance: pc.MeshInstance | undefined;
      try {
        mesh.setPositions(data.positions);
        mesh.setNormals(data.normals);
        mesh.setUvs(0, data.uvs);
        mesh.setIndices(data.indices);
        mesh.update();
        entity = new pc.Entity(`Crop ${batch.chunkKey} ${batch.presentationId} ${batch.stage}`);
        entity.setLocalPosition(...origin);
        instance = new pc.MeshInstance(mesh, material, entity);
        instance.castShadow = false;
        entity.addComponent('render', { meshInstances: [instance], castShadows: false });
        app.root.addChild(entity);
        const metadata = Object.freeze({
          presentationId: batch.presentationId,
          stage: batch.stage,
          positions: Object.freeze(
            batch.positions.map((position) => Object.freeze([...position]) as readonly [number, number, number]),
          ),
        });
        const resource = { batch: metadata, chunkKey: batch.chunkKey, entity, mesh, instance };
        const group = live.get(batch.chunkKey) ?? new Set<CropRenderResource>();
        group.add(resource);
        live.set(batch.chunkKey, group);
        return resource;
      } catch (error) {
        if (!entity?.render) instance?.destroy();
        entity?.destroy();
        mesh.destroy();
        throw error;
      }
    },
    destroy,
    snapshot: () =>
      Object.freeze(
        [...live.values()].flatMap((group) =>
          [...group].map((resource) => {
            const parameter = resource.instance.getParameter('texture_blockLight') as { data?: unknown } | undefined;
            return Object.freeze({
              chunkKey: resource.chunkKey,
              ...resource.batch,
              positions: Object.freeze(
                resource.batch.positions.map(
                  (position) => Object.freeze([...position]) as readonly [number, number, number],
                ),
              ),
              vertexCount: resource.mesh.getPositions([]),
              indexCount: resource.mesh.primitive[0]?.count ?? 0,
              enabled: resource.entity.enabled && resource.instance.visible,
              lightingBound: parameter?.data != null,
            });
          }),
        ),
      ),
    bindChunkLight(key, lighting) {
      const group = live.get(key);
      if (!group?.size) return;
      if (!lighting?.blockLightTexture || !lighting.blockLightOrigin || !lighting.blockLightSize)
        throw new Error('Crop presentation requires its resident terrain light brick.');
      for (const resource of group) {
        lightingReleases.get(resource)?.();
        const bind = () => {
          resource.instance.setParameter('texture_blockLight', lighting.blockLightTexture!);
          resource.instance.setParameter('uBlockLightOrigin', lighting.blockLightOrigin!);
          resource.instance.setParameter('uBlockLightSize', lighting.blockLightSize!);
          resource.instance.setParameter('uBlockLightReady', lighting.blockLightReady ? 1 : 0);
          // The block R8 is a harmless fallback while Sky is unknown and gated off.
          resource.instance.setParameter('texture_skyVisibility', lighting.skyTexture ?? lighting.blockLightTexture!);
          resource.instance.setParameter('uSkyVisibilityOrigin', lighting.skyOrigin ?? lighting.blockLightOrigin!);
          resource.instance.setParameter('uSkyVisibilitySize', CHUNK_SIZE);
          resource.instance.setParameter('uSkyVisibilityReady', lighting.skyTexture && lighting.skyReady ? 1 : 0);
        };
        bind();
        lighting.lightingListeners?.add(bind);
        lightingReleases.set(resource, () => lighting.lightingListeners?.delete(bind));
      }
    },
    dispose,
  };
}
