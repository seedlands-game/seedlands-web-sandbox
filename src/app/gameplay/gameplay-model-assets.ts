import * as pc from 'playcanvas';
import { itemVisualKind } from '../../client/presentation/gameplay-model-definition';
import {
  builtinModelTextures,
  modelMaterialDefinitions,
  type ModelMaterialId,
} from '../../client/presentation/model-material-definitions';
import type { Asset, MaterialAsset, PixelTexture } from '../../client/presentation/asset-types';
import { toolModelDefinition } from '../../client/presentation/voxel-tool-model';
import { resolvePixelModel } from '../../client/presentation/asset-package';
import { itemMeshDefinition, type ItemMeshGroup } from '../../client/presentation/item-mesh-definition';
import { builtinTerrainTextures, terrainMaterials } from '../../client/presentation/terrain-assets';
import { Voxel, type FaceMaterialId } from '../../world/voxel';

import { createPixelMaterial, createPixelMesh, addPixelNode } from './pixel-model-resource';
import { getItemDefinition } from '../../server/gameplay/item-registry';
import { acceptsPixelItem } from '../../client/presentation/asset-adapters';
import { getAppearanceResources, hasAppearanceBinding } from './appearance-runtime';

export { builtinModelTextures, modelMaterialDefinitions } from '../../client/presentation/model-material-definitions';

type MaterialName = ModelMaterialId;

type PartOptions = Readonly<{ castShadows?: boolean; modelId?: string; resolvedAssets?: readonly Asset[] }>;

type MaterialVariant = Readonly<{
  model: Record<MaterialName, pc.StandardMaterial>;
  terrain: ReadonlyMap<FaceMaterialId, pc.StandardMaterial>;
}>;

const builtinModelMaterialAssets: readonly MaterialAsset[] = modelMaterialDefinitions.map((definition) => ({
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

const builtinTerrainMaterialAssets: readonly MaterialAsset[] = terrainMaterials.map((definition) => ({
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
}));

const builtinRuntimeAssets: readonly Asset[] = [
  ...builtinModelTextures,
  ...builtinTerrainTextures,
  ...builtinModelMaterialAssets,
  ...builtinTerrainMaterialAssets,
];

function pixelTextureCanvas(asset: PixelTexture): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = asset.payload.width;
  canvas.height = asset.payload.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('浏览器无法创建模型像素画布');
  const data = context.createImageData(canvas.width, canvas.height);
  asset.payload.pixels.forEach((index, pixel) => {
    const color = asset.payload.palette[index];
    if (!color || index === 0) return;
    data.data.set([color[0], color[1], color[2], 255], pixel * 4);
  });
  context.putImageData(data, 0, 0);
  return canvas;
}

function texture(device: pc.GraphicsDevice, source: PixelTexture) {
  const result = new pc.Texture(device, {
    name: source.id,
    width: source.payload.width,
    height: source.payload.height,
    mipmaps: true,
    srgb: true,
    minFilter: pc.FILTER_NEAREST_MIPMAP_LINEAR,
    magFilter: pc.FILTER_NEAREST,
  });
  result.setSource(pixelTextureCanvas(source));
  return result;
}

export class GameplayModelAssets {
  readonly materials: Record<MaterialName, pc.StandardMaterial>;
  private readonly textures: pc.Texture[];
  private readonly toolMeshes = new Map<string, pc.Mesh>();
  private readonly voxelMeshes = new Map<number, readonly pc.Mesh[]>();
  private readonly materialVariants = new Map<readonly Asset[], MaterialVariant>();
  private readonly toolMaterial = createPixelMaterial();
  private readonly defaultResolvedAssets: readonly Asset[];
  private readonly followsAppearanceRuntime: boolean;

  constructor(
    private readonly app: pc.Application,
    resolvedAssets?: readonly Asset[],
  ) {
    this.textures = [];
    this.followsAppearanceRuntime = resolvedAssets === undefined;
    this.defaultResolvedAssets = resolvedAssets ?? getAppearanceResources(app) ?? [];
    this.materials = this.materialVariant(this.defaultResolvedAssets).model;
  }

  addBox(
    parent: pc.Entity,
    name: string,
    material: MaterialName,
    position: Readonly<{ x: number; y: number; z: number }>,
    scale: Readonly<{ x: number; y: number; z: number }>,
    options: PartOptions = {},
  ) {
    const part = new pc.Entity(name);
    const assets = this.materialAssets(options.modelId, options.resolvedAssets);
    part.addComponent('render', {
      type: 'box',
      material: this.materialVariant(assets).model[material],
      castShadows: options.castShadows ?? true,
    });
    part.setLocalPosition(position.x, position.y, position.z);
    part.setLocalScale(scale.x, scale.y, scale.z);
    parent.addChild(part);
    return part;
  }

  addItem(parent: pc.Entity, itemId: string, scale = 1, resolvedAssets?: readonly Asset[]): void {
    const item = getItemDefinition(itemId);
    const modelId = `builtin:model:${itemId}`;
    const currentAssets = this.toolAssets(modelId, resolvedAssets);
    const currentTool = this.toolDefinition(itemId, currentAssets);
    const definition = currentTool?.definition ?? toolModelDefinition(itemId);
    if (definition) {
      if (!acceptsPixelItem(item)) throw new Error('该物品不能使用像素挤出表现');
      const cacheKey = currentTool?.cacheKey ?? `legacy:${itemId}`;
      let mesh = this.toolMeshes.get(cacheKey);
      if (!mesh) {
        mesh = createPixelMesh(this.app.graphicsDevice, definition);
        // Keep the cached mesh alive between the last displayed instance and its next use.
        mesh.incRefCount();
        this.toolMeshes.set(cacheKey, mesh);
      }
      addPixelNode(parent, `pixel-tool:${itemId}`, mesh, this.toolMaterial, scale);
      return;
    }
    if (item.placesVoxel !== undefined) {
      this.addVoxelItem(parent, itemId, item.placesVoxel, scale, resolvedAssets);
      return;
    }
    const visual = itemVisualKind(itemId);
    if (visual.kind === 'berry-cluster') {
      for (const [x, y, z] of [
        [-0.11, 0, 0],
        [0.11, 0, 0],
        [0, -0.1, 0.06],
      ] as const)
        this.addBox(
          parent,
          'berry',
          'berry',
          { x, y, z },
          { x: 0.22 * scale, y: 0.22 * scale, z: 0.22 * scale },
          {
            modelId,
            resolvedAssets,
          },
        );
      this.addBox(
        parent,
        'berry-leaf',
        'leaf',
        { x: 0.04, y: 0.16, z: 0 },
        { x: 0.2 * scale, y: 0.06 * scale, z: 0.12 * scale },
        { modelId, resolvedAssets },
      );
      return;
    }
    this.addBox(
      parent,
      'plank',
      'wood',
      { x: 0, y: 0, z: 0 },
      { x: 0.68 * scale, y: 0.12 * scale, z: 0.34 * scale },
      { modelId, resolvedAssets },
    );
  }

  dispose(): void {
    this.toolMeshes.forEach((mesh) => {
      mesh.decRefCount();
      mesh.destroy();
    });
    this.toolMeshes.clear();
    this.voxelMeshes.forEach((meshes) =>
      meshes.forEach((mesh) => {
        mesh.decRefCount();
        mesh.destroy();
      }),
    );
    this.voxelMeshes.clear();
    this.toolMaterial.destroy();
    this.materialVariants.forEach((variant) => {
      Object.values(variant.model).forEach((material) => material.destroy());
      variant.terrain.forEach((material) => material.destroy());
    });
    this.materialVariants.clear();
    this.textures.forEach((texture) => texture.destroy());
  }

  private addVoxelItem(
    parent: pc.Entity,
    itemId: string,
    voxel: number,
    scale: number,
    resolvedAssets: readonly Asset[] | undefined,
  ): void {
    const definition = itemMeshDefinition(voxel);
    const meshes = this.voxelMeshes.get(voxel) ?? this.createVoxelMeshes(voxel, definition.groups);
    const modelId = `builtin:model:${itemId}`;
    const variant = this.materialVariant(this.materialAssets(modelId, resolvedAssets));
    const itemScale = voxel === Voxel.Lantern ? 0.72 * scale : 0.38 * scale;
    const item = new pc.Entity(`voxel-item:${itemId}`);
    item.setLocalScale(itemScale, itemScale, itemScale);
    item.setLocalPosition(-itemScale / 2, voxel === Voxel.Lantern ? -0.25 * scale : -itemScale / 2, -itemScale / 2);
    item.addComponent('render', {
      meshInstances: definition.groups.map(
        (group, index) => new pc.MeshInstance(meshes[index], this.terrainMaterial(variant, group.material)),
      ),
    });
    parent.addChild(item);
  }

  private createVoxelMeshes(voxel: number, groups: readonly ItemMeshGroup[]): readonly pc.Mesh[] {
    const meshes = groups.map((group) => {
      const mesh = new pc.Mesh(this.app.graphicsDevice);
      mesh.setPositions(group.positions);
      mesh.setNormals(group.normals);
      mesh.setUvs(0, group.uvs);
      mesh.setIndices(group.indices);
      mesh.update(pc.PRIMITIVE_TRIANGLES);
      // Retain one explicit cache reference between displayed instances.
      mesh.incRefCount();
      return mesh;
    });
    this.voxelMeshes.set(voxel, meshes);
    return meshes;
  }

  private materialVariant(resolvedAssets: readonly Asset[]): MaterialVariant {
    const cached = this.materialVariants.get(resolvedAssets);
    if (cached) return cached;
    const assets = new Map<string, Asset>(builtinRuntimeAssets.map((asset) => [asset.id, asset]));
    resolvedAssets.forEach((asset) => assets.set(asset.id, asset));
    const material = (id: string) => {
      const source = assets.get(id);
      if (source?.type !== 'material') throw new Error(`缺少模型材质：${id}`);
      const textureSource = assets.get(source.payload.textureId);
      if (textureSource?.type !== 'pixel-texture') throw new Error(`缺少模型材质纹理：${source.payload.textureId}`);
      return this.createMaterial(source, textureSource);
    };
    const variant: MaterialVariant = {
      model: Object.fromEntries(
        modelMaterialDefinitions.map((definition) => [
          definition.id,
          material(`seedlands:material/model/${definition.id}`),
        ]),
      ) as Record<MaterialName, pc.StandardMaterial>,
      terrain: new Map(terrainMaterials.map((definition) => [definition.faceMaterial, material(definition.id)])),
    };
    this.materialVariants.set(resolvedAssets, variant);
    return variant;
  }

  private createMaterial(definition: MaterialAsset, source: PixelTexture): pc.StandardMaterial {
    const diffuseMap = texture(this.app.graphicsDevice, source);
    this.textures.push(diffuseMap);
    const material = new pc.StandardMaterial();
    material.name = definition.id;
    material.diffuseMap = diffuseMap;
    material.diffuse = pc.Color.WHITE;
    material.gloss = 1 - definition.payload.roughness;
    material.metalness = definition.payload.metalness;
    material.useMetalness = definition.payload.metalness > 0;
    material.emissive = new pc.Color(...definition.payload.emissive);
    material.emissiveIntensity = definition.payload.emissiveIntensity;
    if (definition.payload.renderMode === 'cutout') {
      material.opacityMap = diffuseMap;
      material.opacityMapChannel = 'a';
      material.alphaTest = 0.5;
      material.twoSidedLighting = true;
    }
    if (definition.payload.renderMode === 'transparent') {
      material.opacityMap = diffuseMap;
      material.opacityMapChannel = 'a';
      material.opacity = 0.65;
      material.blendType = pc.BLEND_NORMAL;
      material.depthWrite = false;
      material.opacityFadesSpecular = false;
    }
    material.update();
    return material;
  }

  private materialAssets(modelId: string | undefined, resolvedAssets: readonly Asset[] | undefined): readonly Asset[] {
    if (resolvedAssets) return resolvedAssets;
    if (modelId && hasAppearanceBinding(this.app, modelId))
      return getAppearanceResources(this.app, modelId) ?? this.defaultResolvedAssets;
    return this.currentAssets();
  }

  private toolAssets(modelId: string, resolvedAssets: readonly Asset[] | undefined): readonly Asset[] {
    if (resolvedAssets) return resolvedAssets;
    if (this.followsAppearanceRuntime) return getAppearanceResources(this.app, modelId) ?? this.currentAssets();
    return this.defaultResolvedAssets;
  }

  private currentAssets(): readonly Asset[] {
    return this.followsAppearanceRuntime
      ? (getAppearanceResources(this.app) ?? this.defaultResolvedAssets)
      : this.defaultResolvedAssets;
  }

  private toolDefinition(
    itemId: string,
    assets: readonly Asset[],
  ): Readonly<{ definition: ReturnType<typeof toolModelDefinition>; cacheKey: string }> | null {
    const model = assets.find((asset) => asset.id === `builtin:model:${itemId}`);
    if (model?.type !== 'extruded-pixel-model') return null;
    const texture = assets.find((asset) => asset.id === model.payload.textureId);
    if (texture?.type !== 'pixel-texture') throw new Error(`工具像素模型缺少贴图：${model.payload.textureId}`);
    return {
      definition: resolvePixelModel(model, assets),
      cacheKey: `${model.id}:${model.revision}:${model.payload.textureId}:${texture.revision}`,
    };
  }

  private terrainMaterial(variant: MaterialVariant, material: FaceMaterialId): pc.StandardMaterial {
    const result = variant.terrain.get(material);
    if (!result) throw new Error(`缺少体素面材质：${material}`);
    return result;
  }
}

type SharedAssets = { assets: GameplayModelAssets; references: number };
const sharedAssets = new WeakMap<pc.Application, SharedAssets>();

export type GameplayModelAssetsLease = Readonly<{ assets: GameplayModelAssets; release: () => void }>;

/** Shares the small material/texture set between world actors and the camera viewmodel. */
export function acquireGameplayModelAssets(app: pc.Application): GameplayModelAssetsLease {
  let shared = sharedAssets.get(app);
  if (!shared) {
    shared = { assets: new GameplayModelAssets(app), references: 0 };
    sharedAssets.set(app, shared);
  }
  shared.references += 1;
  let released = false;
  return {
    assets: shared.assets,
    release: () => {
      if (released) return;
      released = true;
      shared!.references -= 1;
      if (shared!.references === 0) {
        shared!.assets.dispose();
        sharedAssets.delete(app);
      }
    },
  };
}
