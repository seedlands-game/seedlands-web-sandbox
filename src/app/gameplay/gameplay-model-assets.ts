import * as pc from 'playcanvas';
import { itemVisualKind } from '../../client/presentation/gameplay-model-definition';
import {
  builtinModelTextures,
  modelMaterialDefinitions,
  type ModelMaterialId,
} from '../../client/presentation/model-material-definitions';
import type { PixelTexture } from '../../client/presentation/asset-types';
import { toolModelDefinition } from '../../client/presentation/voxel-tool-model';

import { createPixelMaterial, createPixelMesh, addPixelNode } from './pixel-model-resource';
import { getItemDefinition } from '../../server/gameplay/item-registry';
import { acceptsPixelItem } from '../../client/presentation/asset-adapters';

export { builtinModelTextures, modelMaterialDefinitions } from '../../client/presentation/model-material-definitions';

type MaterialName = ModelMaterialId;

type PartOptions = Readonly<{ castShadows?: boolean }>;

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
    minFilter: pc.FILTER_NEAREST_MIPMAP_NEAREST,
    magFilter: pc.FILTER_NEAREST,
  });
  result.setSource(pixelTextureCanvas(source));
  return result;
}

export class GameplayModelAssets {
  readonly materials: Record<MaterialName, pc.StandardMaterial>;
  private readonly textures: pc.Texture[];
  private readonly toolMeshes = new Map<string, pc.Mesh>();
  private readonly toolMaterial = createPixelMaterial();

  constructor(private readonly app: pc.Application) {
    this.textures = [];
    this.materials = Object.fromEntries(
      modelMaterialDefinitions.map((definition) => {
        const source = builtinModelTextures.find((candidate) => candidate.id === definition.textureId);
        if (!source) throw new Error(`缺少模型材质纹理：${definition.textureId}`);
        const diffuseMap = texture(app.graphicsDevice, source);
        this.textures.push(diffuseMap);
        const material = new pc.StandardMaterial();
        material.name = definition.textureId;
        material.diffuseMap = diffuseMap;
        material.diffuse = pc.Color.WHITE;
        material.gloss = 1 - definition.roughness;
        material.metalness = definition.metalness;
        material.emissive = new pc.Color(...definition.emissive);
        material.emissiveIntensity = definition.emissiveIntensity;
        material.update();
        return [definition.id, material];
      }),
    ) as Record<MaterialName, pc.StandardMaterial>;
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
    part.addComponent('render', {
      type: 'box',
      material: this.materials[material],
      castShadows: options.castShadows ?? true,
    });
    part.setLocalPosition(position.x, position.y, position.z);
    part.setLocalScale(scale.x, scale.y, scale.z);
    parent.addChild(part);
    return part;
  }

  addItem(parent: pc.Entity, itemId: string, scale = 1): void {
    const definition = toolModelDefinition(itemId);
    if (definition) {
      if (!acceptsPixelItem(getItemDefinition(itemId))) throw new Error('该物品不能使用像素挤出表现');
      let mesh = this.toolMeshes.get(itemId);
      if (!mesh) {
        mesh = createPixelMesh(this.app.graphicsDevice, definition);
        // Keep the cached mesh alive between the last displayed instance and its next use.
        mesh.incRefCount();
        this.toolMeshes.set(itemId, mesh);
      }
      addPixelNode(parent, `pixel-tool:${itemId}`, mesh, this.toolMaterial, scale);
      return;
    }
    const visual = itemVisualKind(itemId);
    if (visual.kind === 'voxel-block') return this.addBlock(parent, itemId, scale);
    if (visual.kind === 'berry-cluster') {
      for (const [x, y, z] of [
        [-0.11, 0, 0],
        [0.11, 0, 0],
        [0, -0.1, 0.06],
      ] as const)
        this.addBox(parent, 'berry', 'berry', { x, y, z }, { x: 0.22 * scale, y: 0.22 * scale, z: 0.22 * scale });
      this.addBox(
        parent,
        'berry-leaf',
        'leaf',
        { x: 0.04, y: 0.16, z: 0 },
        { x: 0.2 * scale, y: 0.06 * scale, z: 0.12 * scale },
      );
      return;
    }
    if (visual.kind === 'lantern') {
      this.addBox(
        parent,
        'lantern-core',
        'glow',
        { x: 0, y: 0, z: 0 },
        { x: 0.3 * scale, y: 0.36 * scale, z: 0.3 * scale },
      );
      for (const y of [-0.22, 0.22])
        this.addBox(
          parent,
          'lantern-rim',
          'brass',
          { x: 0, y: y * scale, z: 0 },
          { x: 0.4 * scale, y: 0.06 * scale, z: 0.4 * scale },
        );
      this.addBox(
        parent,
        'lantern-handle',
        'brass',
        { x: 0, y: 0.39 * scale, z: 0 },
        { x: 0.2 * scale, y: 0.08 * scale, z: 0.08 * scale },
      );
      for (const x of [-0.08, 0.08])
        this.addBox(
          parent,
          'lantern-handle-support',
          'brass',
          { x: x * scale, y: 0.3 * scale, z: 0 },
          { x: 0.04 * scale, y: 0.18 * scale, z: 0.06 * scale },
        );
      return;
    }
    this.addBox(parent, 'plank', 'wood', { x: 0, y: 0, z: 0 }, { x: 0.68 * scale, y: 0.12 * scale, z: 0.34 * scale });
  }

  dispose(): void {
    this.toolMeshes.forEach((mesh) => {
      mesh.decRefCount();
      mesh.destroy();
    });
    this.toolMeshes.clear();
    this.toolMaterial.destroy();
    Object.values(this.materials).forEach((material) => material.destroy());
    this.textures.forEach((texture) => texture.destroy());
  }

  private addBlock(parent: pc.Entity, itemId: string, scale: number): void {
    const material: MaterialName =
      itemId === 'stone-block'
        ? 'stone'
        : itemId === 'sand-block'
          ? 'sand'
          : itemId === 'wood-block'
            ? 'wood'
            : itemId === 'glowstone-block'
              ? 'glow'
              : 'dirt';
    const half = 0.19 * scale;
    this.addBox(parent, 'block-core', material, { x: 0, y: 0, z: 0 }, { x: half * 2, y: half * 2, z: half * 2 });
    const cap: MaterialName = itemId === 'wood-block' ? 'wood-end' : material;
    this.addBox(parent, 'block-top-face', cap, { x: 0, y: half + 0.002, z: 0 }, { x: half * 2, y: 0.012, z: half * 2 });
    if (itemId === 'wood-block')
      this.addBox(
        parent,
        'block-bottom-face',
        cap,
        { x: 0, y: -half - 0.002, z: 0 },
        { x: half * 2, y: 0.012, z: half * 2 },
      );
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
