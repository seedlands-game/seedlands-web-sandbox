import * as pc from 'playcanvas';

export function meshState() {
  const nodes = pc.Application.getApplication()!.root.find(
    (node) => node.name === 'pixel-tool:stone-pickaxe',
  ) as pc.Entity[];
  const meshes = nodes.map((node) => node.render!.meshInstances[0].mesh);
  return { count: meshes.length, same: meshes.length === 2 && meshes[0] === meshes[1] };
}
