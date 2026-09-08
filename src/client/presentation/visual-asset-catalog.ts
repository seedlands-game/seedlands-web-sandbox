import { Voxel, voxelNames, faceMaterialFor } from '../../world/voxel';
import { modelBoxesForVoxel } from '../../world/voxel-model';
import type { Asset, MaterialAsset } from './asset-types';
import { builtinTerrainTextures, terrainMaterials } from './terrain-assets';
import { builtinModelTextures, modelMaterialDefinitions } from './model-material-definitions';
import { actorModelDefinitions, playerArmModelDefinition } from './actor-model-definitions';

const modelMaterialAssets: MaterialAsset[] = modelMaterialDefinitions.map((definition) => ({
  id: `seedlands:material/model/${definition.id}`,
  name: `${definition.name}材质`,
  revision: 1,
  source: 'builtin',
  type: 'material',
  payload: {
    textureId: definition.textureId,
    renderMode: 'opaque',
    roughness: definition.roughness,
    metalness: definition.metalness,
    emissive: definition.emissive,
    emissiveIntensity: definition.emissiveIntensity,
  },
}));
const images = [
  ['ui/health-heart.png', '生命图标'],
  ['ui/hunger-drumstick.png', '饥饿图标'],
  ['ui/arcane-crest.png', '奥术徽记'],
  ['ui/obsidian-brass-panel.png', '面板边框'],
  ['ui/obsidian-hotbar-slot.png', '快捷栏底框'],
  ['voxels/grass.png', '草方块目标图标'],
  ['voxels/leaves.png', '树叶目标图标'],
  ['voxels/snow.png', '雪目标图标'],
];
export const builtinVisualAssets: Asset[] = [
  ...images.map(([path, name]): Asset => ({
    id: `seedlands:image/${path}`,
    name,
    source: 'builtin',
    revision: 1,
    type: 'image-texture',
    payload: { path: `assets/${path}` },
  })),
  ...builtinTerrainTextures,
  ...builtinModelTextures,
  ...modelMaterialAssets,
  ...terrainMaterials.map((definition): MaterialAsset => ({
    id: definition.id,
    name: `${definition.name}材质`,
    revision: 1,
    source: 'builtin',
    type: 'material',
    payload: {
      textureId: definition.textureId,
      renderMode: definition.renderMode,
      roughness: definition.renderMode === 'transparent' ? 0.18 : 0.92,
      metalness: 0,
      emissive: [1, 0.48, 0.1],
      emissiveIntensity: definition.emissiveIntensity,
    },
  })),
  ...Object.values(Voxel)
    .filter((id) => id !== Voxel.Air)
    .map((voxelId): Asset => {
      const faces = new Set([
        ...Array.from({ length: 6 }, (_, i) => faceMaterialFor(voxelId, Math.floor(i / 2), i % 2 === 0)),
        ...modelBoxesForVoxel(voxelId).map((box) => box.material),
      ]);
      return {
        id: `seedlands:model/voxel/${voxelId}`,
        name: voxelNames[voxelId],
        revision: 1,
        source: 'builtin',
        type: 'builtin-voxel-model',
        payload: { voxelId, materialIds: terrainMaterials.filter((m) => faces.has(m.faceMaterial)).map((m) => m.id) },
      };
    }),
  ...(['player', 'settler', 'grazer', 'stalker'] as const).map((kind): Asset => ({
    id: `seedlands:model/actor/${kind}`,
    name: { player: '玩家', settler: '居民', grazer: '食草兽', stalker: '潜行兽' }[kind],
    revision: 1,
    source: 'builtin',
    type: 'builtin-actor-model',
    payload: {
      kind,
      materialIds: [
        ...new Set(actorModelDefinitions[kind].parts.map((part) => `seedlands:material/model/${part.material}`)),
      ],
    },
  })),
  {
    id: 'seedlands:model/player-arm',
    name: '玩家手臂',
    revision: 1,
    source: 'builtin',
    type: 'builtin-arm-model',
    payload: {
      materialIds: [
        ...new Set(playerArmModelDefinition.parts.map((part) => `seedlands:material/model/${part.material}`)),
      ],
    },
  },
];
