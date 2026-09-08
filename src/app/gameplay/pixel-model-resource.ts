import * as pc from 'playcanvas';
import { buildToolMesh } from '../../client/presentation/voxel-tool-model';
import type { ToolModel } from '../../client/presentation/asset-types';

export function createPixelMaterial() {
  const material = new pc.StandardMaterial();
  material.name = 'pixel-tool-palette';
  material.diffuse = pc.Color.WHITE;
  material.diffuseVertexColor = true;
  material.gloss = 0.12;
  material.update();
  return material;
}
export function createPixelMesh(device: pc.GraphicsDevice, definition: ToolModel) {
  const data = buildToolMesh(definition);
  const mesh = new pc.Mesh(device);
  mesh.setPositions(data.positions);
  mesh.setNormals(data.normals);
  mesh.setColors(data.colors);
  mesh.setIndices(data.indices);
  mesh.update(pc.PRIMITIVE_TRIANGLES);
  return mesh;
}
export function addPixelNode(
  parent: pc.Entity,
  name: string,
  mesh: pc.Mesh,
  material: pc.StandardMaterial,
  scale: number,
) {
  const node = new pc.Entity(name);
  node.setLocalScale(scale, scale, scale);
  node.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, material)] });
  parent.addChild(node);
  return node;
}
/** Uncached draft lease; releasing also removes the node before its retained mesh. */
export function createDraftPixelResource(app: pc.Application, parent: pc.Entity, definition: ToolModel, scale = 1) {
  const material = createPixelMaterial();
  const mesh = createPixelMesh(app.graphicsDevice, definition);
  mesh.incRefCount();
  const node = addPixelNode(parent, 'draft-pixel-model', mesh, material, scale);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    node.destroy();
    mesh.decRefCount();
    mesh.destroy();
    material.destroy();
  };
}
