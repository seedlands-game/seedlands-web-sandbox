import * as pc from 'playcanvas';
import { CHUNK_SIZE } from '@seedlands/stdlib/world/voxel';
import type { PackPresentationCatalog } from '../../client/presentation/pack-presentation-loader';
import { buildCropStageGeometry } from '../../client/presentation/crop-stage-geometry';
import { voxelBlockLightGlsl } from '../shaders/voxel-block-light-chunk';
import type { CropStageAdapter, CropStageBatch } from './crop-stage-presenter';

export type CropRenderResource = Readonly<{
  chunkKey: string;
  entity: pc.Entity;
  mesh: pc.Mesh;
  instance: pc.MeshInstance;
}>;
type ChunkLighting = Readonly<{
  blockLightTexture?: pc.Texture;
  blockLightOrigin?: Float32Array;
  blockLightSize?: number;
}>;
export type PlayCanvasCropPresentation = CropStageAdapter<CropRenderResource> &
  Readonly<{
    definitions: NonNullable<PackPresentationCatalog['crops']>;
    bindChunkLight(key: string, lighting: ChunkLighting | undefined): void;
    dispose(): void;
  }>;

const cropEmissionGlsl = `${voxelBlockLightGlsl}
void getEmission() {
    dEmission = dAlbedo * blockLightAtSurface() * 0.78;
}`;

/** Owns disposable GPU assets only; terrain light bricks are borrowed, never destroyed here. */
export async function createPlayCanvasCropPresentation(
  app: pc.Application,
  catalog: PackPresentationCatalog,
): Promise<PlayCanvasCropPresentation> {
  const definitions = catalog.crops ?? {};
  const materials = new Map<string, pc.StandardMaterial>();
  const textures: pc.Texture[] = [];
  const live = new Map<string, Set<CropRenderResource>>();
  let disposed = false;
  const destroy = (resource: CropRenderResource) => {
    const group = live.get(resource.chunkKey);
    if (!group?.delete(resource)) return;
    if (!group.size) live.delete(resource.chunkKey);
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
        material.emissive.set(1, 1, 1);
        material.shaderChunksVersion = '2.8';
        material.getShaderChunks(pc.SHADERLANGUAGE_GLSL).set('emissivePS', cropEmissionGlsl);
        material.update();
      }
    }
  } catch (error) {
    dispose();
    throw error;
  }
  return {
    definitions,
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
        const resource = { chunkKey: batch.chunkKey, entity, mesh, instance };
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
    bindChunkLight(key, lighting) {
      const group = live.get(key);
      if (!group?.size) return;
      if (!lighting?.blockLightTexture || !lighting.blockLightOrigin || !lighting.blockLightSize)
        throw new Error('Crop presentation requires its resident terrain light brick.');
      for (const resource of group) {
        resource.instance.setParameter('texture_blockLight', lighting.blockLightTexture);
        resource.instance.setParameter('uBlockLightOrigin', lighting.blockLightOrigin);
        resource.instance.setParameter('uBlockLightSize', lighting.blockLightSize);
      }
    },
    dispose,
  };
}
