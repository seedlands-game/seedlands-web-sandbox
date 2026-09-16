import { expect, it } from 'vitest';
import { builtinAssets, builtinItemBindings } from '../../../src/client/presentation/asset-catalog';
import { assetDependencies } from '../../../src/client/presentation/asset-adapters';
import { Voxel, FaceMaterial } from '../../../../../packages/stdlib/src/world/voxel';
import { terrainMaterials } from '../../../src/client/presentation/terrain-assets';
import { actorModelDefinitions } from '../../../src/client/presentation/actor-model-definitions';
import { listItemDefinitions } from '../../fixtures/classic/content';

it('当前视觉目录覆盖全部方块、面、物品、角色和手臂，引用能解析', () => {
  const ids = new Set(builtinAssets.map((a) => a.id));
  expect(ids.size).toBe(builtinAssets.length);
  expect(
    builtinAssets
      .filter((a) => a.type === 'builtin-voxel-model')
      .map((a) => a.payload.voxelId)
      .sort((a, b) => a - b),
  ).toEqual(Object.values(Voxel).filter((v) => v !== Voxel.Air));
  expect(terrainMaterials.map((m) => m.faceMaterial)).toEqual(Object.values(FaceMaterial));
  expect(builtinItemBindings.map((b) => b.itemId).sort()).toEqual(
    listItemDefinitions()
      .map((i) => i.id)
      .sort(),
  );
  expect(
    builtinAssets
      .filter((a) => a.type === 'builtin-actor-model')
      .map((a) => a.payload.kind)
      .sort(),
  ).toEqual(Object.keys(actorModelDefinitions).sort());
  expect(builtinAssets.some((a) => a.type === 'builtin-arm-model')).toBe(true);
  for (const asset of builtinAssets)
    for (const id of assetDependencies(asset)) expect(ids.has(id), `${asset.id} → ${id}`).toBe(true);
});
