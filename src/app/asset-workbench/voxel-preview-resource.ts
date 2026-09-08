import * as pc from 'playcanvas';
import type { Asset, PixelTexture } from '../../client/presentation/asset-types';
import { meshChunk } from '../../world/mesh';
import { batchMeshData } from '../../world/mesh-batching';
import { CHUNK_SIZE, voxelIndex, type FaceMaterialId } from '../../world/voxel';
import { createVoxelMaterials } from '../scene/voxel-materials';
import { QUALITY_PROFILES } from '../scene/quality-profile';
import { renderCategoryForFaceMaterial } from '../scene/voxel-render-pipeline';

// A single-cell chunk goes through the same geometry compiler and materials as the world.
export async function addVoxelPreview(
  app: pc.Application,
  parent: pc.Entity,
  voxelId: number,
  materialOverride?: FaceMaterialId,
  assets?: readonly Asset[],
) {
  const materials = await createVoxelMaterials(
    app,
    QUALITY_PROFILES.high,
    assets?.filter((asset): asset is PixelTexture => asset.type === 'pixel-texture'),
    assets,
  );
  const data = new Uint16Array(CHUNK_SIZE ** 3);
  data[voxelIndex(0, 0, 0)] = voxelId;
  const parts = batchMeshData(
    Object.values(meshChunk({ seed: 1, cx: 0, cy: 0, cz: 0, data, changes: [], outside: () => 0 })),
  );
  const content = new pc.Entity('Voxel source mesh', app);
  content.setLocalPosition(-0.5, -0.5, -0.5);
  parent.addChild(content);
  try {
    for (const part of parts) {
      if (materialOverride) {
        part.renderCategory = renderCategoryForFaceMaterial(materialOverride);
        for (let i = 3; i < part.colors.length; i += 4) part.colors[i] = materialOverride - 1;
      }
      const mesh = new pc.Mesh(app.graphicsDevice);
      mesh.setPositions(part.positions);
      mesh.setNormals(part.normals);
      mesh.setUvs(0, part.uvs);
      mesh.setColors32(part.colors);
      mesh.setIndices(part.indices);
      mesh.update();
      const node = new pc.Entity(`voxel-preview-${part.renderCategory}`, app);
      content.addChild(node);
      node.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, materials.resolve(part), node)] });
    }
  } catch (error) {
    content.destroy();
    materials.destroy();
    throw error;
  }
  let released = false;
  return () => {
    if (released) return;
    released = true;
    content.destroy();
    materials.destroy();
  };
}
