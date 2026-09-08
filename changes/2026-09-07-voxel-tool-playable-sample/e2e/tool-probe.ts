import * as pc from 'playcanvas';
import { acquireGameplayModelAssets } from '../../../src/app/gameplay/gameplay-model-assets';

export function presentedTool(itemId: string) {
  const app = pc.Application.getApplication();
  const held = app?.root.findByName('viewmodel replaceable item') as pc.Entity | null | undefined;
  const node = held?.findByName(`pixel-tool:${itemId}`) as pc.Entity | null;
  const pivot = app?.root.findByName('viewmodel hand pivot') as pc.Entity | null | undefined;
  return {
    name: node?.name ?? null,
    meshes: node?.render?.meshInstances.length ?? 0,
    vertices: node?.render?.meshInstances[0]?.mesh.vertexBuffer?.numVertices ?? 0,
    rotation: pivot?.getLocalEulerAngles().toArray() ?? [],
    hand: Boolean(app?.root.findByName('hand')),
  };
}

export function worldMatchesHeld(itemId: string) {
  const nodes = pc.Application.getApplication()!.root.find(
    (node) => node.name === `pixel-tool:${itemId}`,
  ) as pc.Entity[];
  const meshes = nodes.map((node) => node.render!.meshInstances[0].mesh);
  return { count: nodes.length, same: meshes.length === 2 && meshes[0] === meshes[1] };
}

export function resourceLifecycle() {
  const live = pc.Application.getApplication()!;
  // An isolated cache key with the real GPU prevents this probe from releasing the live world's lease.
  const owner = { graphicsDevice: live.graphicsDevice } as pc.Application;
  const first = acquireGameplayModelAssets(owner);
  const last = acquireGameplayModelAssets(owner);
  const a = new pc.Entity('lease-probe-a', live);
  const b = new pc.Entity('lease-probe-b', live);
  first.assets.addItem(a, 'wood-axe');
  last.assets.addItem(b, 'wood-axe', 0.55);
  const meshA = (a.children[0] as pc.Entity).render!.meshInstances[0].mesh;
  const meshB = (b.children[0] as pc.Entity).render!.meshInstances[0].mesh;
  let destroyed = 0;
  const destroy = meshA.destroy.bind(meshA);
  meshA.destroy = () => {
    destroyed += 1;
    destroy();
  };
  const same = meshA === meshB;
  a.destroy();
  b.destroy();
  const afterNodes = destroyed;
  first.release();
  const afterFirstLease = destroyed;
  const reused = new pc.Entity('lease-probe-reuse', live);
  last.assets.addItem(reused, 'wood-axe');
  const sameAfterEmpty = (reused.children[0] as pc.Entity).render!.meshInstances[0].mesh === meshA;
  reused.destroy();
  last.release();
  last.release();
  return { same, sameAfterEmpty, afterNodes, afterFirstLease, destroyed };
}
