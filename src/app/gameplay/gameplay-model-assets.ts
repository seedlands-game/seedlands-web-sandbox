import * as pc from 'playcanvas';
import { itemVisualKind } from '../../client/presentation/gameplay-model-definition';
import { buildToolMesh, toolModelDefinition } from '../../client/presentation/voxel-tool-model';

type MaterialName =
  | 'dirt'
  | 'stone'
  | 'wood'
  | 'wood-end'
  | 'sand'
  | 'leaf'
  | 'brass'
  | 'glow'
  | 'berry'
  | 'cream'
  | 'umber'
  | 'fur'
  | 'charcoal'
  | 'teal'
  | 'skin'
  | 'cloth'
  | 'boot'
  | 'eye'
  | 'glow-eye'
  | 'hurt';

type PartOptions = Readonly<{ castShadows?: boolean }>;

const swatches: Record<MaterialName, readonly [string, string, string]> = {
  dirt: ['#70462d', '#9d6740', '#4f2f21'],
  stone: ['#606b6a', '#929c95', '#3d474a'],
  wood: ['#6e3d20', '#b37239', '#3f2116'],
  'wood-end': ['#a96632', '#e2a458', '#623719'],
  sand: ['#c6a35d', '#e3c978', '#97733f'],
  leaf: ['#2d6b48', '#5f9c56', '#183d32'],
  brass: ['#8b5929', '#d09a44', '#55341f'],
  glow: ['#f7d66c', '#fff6bd', '#bd6024'],
  berry: ['#6c2646', '#bd4d69', '#3c1932'],
  cream: ['#d6bd78', '#fff0b4', '#8f7144'],
  umber: ['#6a402b', '#805038', '#4d3025'],
  fur: ['#8d7653', '#a68b62', '#6c583f'],
  charcoal: ['#1d3235', '#365b59', '#101d24'],
  teal: ['#1c6f78', '#43a1a0', '#113e4a'],
  skin: ['#b36d4b', '#e0a16a', '#70422f'],
  cloth: ['#17555d', '#3e8b8a', '#103640'],
  boot: ['#252a30', '#485057', '#12161d'],
  eye: ['#151823', '#f6f0d2', '#090b11'],
  'glow-eye': ['#4c2415', '#ffc257', '#170d10'],
  hurt: ['#8a1f1b', '#f06542', '#4d1114'],
};

function texture(device: pc.GraphicsDevice, name: string, colors: readonly [string, string, string]) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 24;
  const context = canvas.getContext('2d')!;
  context.fillStyle = colors[0];
  context.fillRect(0, 0, 24, 24);
  for (let y = 0; y < 24; y += 4)
    for (let x = 0; x < 24; x += 4) {
      const pick = (x * 7 + y * 11 + x * y) % (name === 'fur' || name === 'skin' || name === 'cloth' ? 11 : 5);
      context.fillStyle = pick === 0 ? colors[1] : pick === 1 ? colors[2] : colors[0];
      context.fillRect(x, y, name === 'fur' ? 4 : 3, name === 'fur' ? 2 : 3);
    }
  if (name === 'wood') {
    context.fillStyle = colors[2];
    for (const x of [4, 12, 20]) context.fillRect(x, 0, 2, 24);
  }
  const result = new pc.Texture(device, { name: `model-${name}`, width: 24, height: 24, mipmaps: true, srgb: true });
  result.setSource(canvas);
  return result;
}

export class GameplayModelAssets {
  readonly materials: Record<MaterialName, pc.StandardMaterial>;
  private readonly textures: pc.Texture[];
  private readonly toolMeshes = new Map<string, pc.Mesh>();
  private readonly toolMaterial = new pc.StandardMaterial();

  constructor(private readonly app: pc.Application) {
    this.toolMaterial.name = 'pixel-tool-palette';
    this.toolMaterial.diffuse = pc.Color.WHITE;
    this.toolMaterial.diffuseVertexColor = true;
    this.toolMaterial.gloss = 0.12;
    this.toolMaterial.update();
    this.textures = [];
    this.materials = Object.fromEntries(
      (Object.entries(swatches) as [MaterialName, readonly [string, string, string]][]).map(([name, colors]) => {
        const diffuseMap = texture(app.graphicsDevice, name, colors);
        this.textures.push(diffuseMap);
        const material = new pc.StandardMaterial();
        material.name = `model-${name}`;
        material.diffuseMap = diffuseMap;
        material.diffuse = pc.Color.WHITE;
        material.gloss = name === 'brass' ? 0.5 : 0.08;
        material.metalness = name === 'brass' ? 0.35 : 0;
        if (name === 'glow' || name === 'glow-eye') {
          material.emissive = new pc.Color(1, 0.46, 0.1);
          material.emissiveIntensity = name === 'glow-eye' ? 1.5 : 0.55;
        }
        material.update();
        return [name, material];
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
      let mesh = this.toolMeshes.get(itemId);
      if (!mesh) {
        const data = buildToolMesh(definition);
        mesh = new pc.Mesh(this.app.graphicsDevice);
        mesh.setPositions(data.positions);
        mesh.setNormals(data.normals);
        mesh.setColors(data.colors);
        mesh.setIndices(data.indices);
        mesh.update(pc.PRIMITIVE_TRIANGLES);
        // Keep the cached mesh alive between the last displayed instance and its next use.
        mesh.incRefCount();
        this.toolMeshes.set(itemId, mesh);
      }
      const node = new pc.Entity(`pixel-tool:${itemId}`);
      node.setLocalScale(scale, scale, scale);
      node.addComponent('render', { meshInstances: [new pc.MeshInstance(mesh, this.toolMaterial)] });
      parent.addChild(node);
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
