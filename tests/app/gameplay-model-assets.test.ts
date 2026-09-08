import { describe, expect, it, vi } from 'vitest';

vi.stubGlobal('document', {
  createElement: () => ({
    width: 0,
    height: 0,
    getContext: () => ({
      createImageData: (width: number, height: number) => ({ data: { set: () => {} }, width, height }),
      putImageData: () => {},
    }),
  }),
});

const state = vi.hoisted(() => ({
  meshes: [] as Array<{ positions: number[]; indices: number[]; destroyed: boolean }>,
}));

type RenderNode = {
  render: {
    meshInstances: Array<{ mesh: { indices: number[]; destroyed: boolean }; material: unknown }>;
    material?: unknown;
  };
};

const firstChild = (entity: unknown) => (entity as { children: RenderNode[] }).children[0];

vi.mock('playcanvas', () => {
  class Entity {
    children: Entity[] = [];
    render: { meshInstances: MeshInstance[]; material?: unknown } | null = null;
    constructor(readonly name = '') {}
    addComponent(kind: string, options: { meshInstances?: MeshInstance[]; material?: unknown }) {
      if (kind === 'render') this.render = { meshInstances: options.meshInstances ?? [], material: options.material };
    }
    addChild(child: Entity) {
      this.children.push(child);
    }
    setLocalPosition() {}
    setLocalScale() {}
  }
  class Mesh {
    positions: number[] = [];
    indices: number[] = [];
    destroyed = false;
    constructor(_device: unknown) {
      state.meshes.push(this);
    }
    setPositions(value: number[]) {
      this.positions = value;
    }
    setNormals() {}
    setColors() {}
    setUvs() {}
    setIndices(value: number[]) {
      this.indices = value;
    }
    update() {}
    incRefCount() {}
    decRefCount() {}
    destroy() {
      this.destroyed = true;
    }
  }
  class MeshInstance {
    constructor(
      readonly mesh: Mesh,
      readonly material: unknown,
    ) {}
  }
  class Texture {
    name = '';
    minFilter: unknown;
    constructor(_device: unknown, options: { name: string; minFilter: unknown }) {
      this.name = options.name;
      this.minFilter = options.minFilter;
    }
    setSource() {}
    destroy() {}
  }
  class StandardMaterial {
    name = '';
    diffuseMap: Texture | null = null;
    diffuse: unknown;
    gloss = 0;
    metalness = 0;
    useMetalness = false;
    emissive: unknown;
    emissiveIntensity = 0;
    opacityMap: Texture | null = null;
    opacityMapChannel = '';
    alphaTest = 0;
    blendType = 0;
    depthWrite = true;
    opacity = 1;
    opacityFadesSpecular = true;
    twoSidedLighting = false;
    update() {}
    destroy() {}
  }
  class Color {
    static WHITE = new Color();
    constructor(..._values: number[]) {}
  }
  return {
    Entity,
    Mesh,
    MeshInstance,
    Texture,
    StandardMaterial,
    Color,
    FILTER_NEAREST_MIPMAP_NEAREST: 1,
    FILTER_NEAREST_MIPMAP_LINEAR: 2,
    FILTER_NEAREST: 1,
    BLEND_NORMAL: 2,
    PRIMITIVE_TRIANGLES: 4,
  };
});

describe('玩法物品共享网格资源', () => {
  it('灯笼每个实例只挂两个材质组，并复用缓存的两份 Mesh', async () => {
    const { GameplayModelAssets } = await import('../../apps/web/src/app/gameplay/gameplay-model-assets');
    const pc = await import('playcanvas');
    const assets = new GameplayModelAssets({ graphicsDevice: {} } as never);
    const first = new pc.Entity('first');
    const second = new pc.Entity('second');

    assets.addItem(first, 'lantern');
    assets.addItem(second, 'lantern');

    expect(first.children).toHaveLength(1);
    expect(firstChild(first).render.meshInstances).toHaveLength(2);
    expect(firstChild(second).render.meshInstances.map((instance) => instance.mesh)).toEqual(
      firstChild(first).render.meshInstances.map((instance) => instance.mesh),
    );
    const meshes = firstChild(first).render.meshInstances.map((instance) => instance.mesh);
    assets.dispose();
    expect(meshes.every((mesh) => mesh.destroyed)).toBe(true);
  });

  it('普通方块也由同一静态网格入口按面材质分组', async () => {
    const { GameplayModelAssets } = await import('../../apps/web/src/app/gameplay/gameplay-model-assets');
    const pc = await import('playcanvas');
    const assets = new GameplayModelAssets({ graphicsDevice: {} } as never);
    const parent = new pc.Entity('wood');

    assets.addItem(parent, 'wood-block', 0.55);

    expect(parent.children).toHaveLength(1);
    expect(firstChild(parent).render.meshInstances).toHaveLength(2);
    assets.dispose();
  });

  it('构造器按资源 ID 优先使用传入的模型材质与像素贴图', async () => {
    const { GameplayModelAssets } = await import('../../apps/web/src/app/gameplay/gameplay-model-assets');
    const texture = {
      id: 'custom:brass',
      name: '定制黄铜',
      revision: 2,
      source: 'user' as const,
      type: 'pixel-texture' as const,
      payload: {
        width: 16,
        height: 16,
        palette: [
          [0, 0, 0],
          [220, 120, 20],
        ] as [number, number, number][],
        pixels: Array(256).fill(1),
      },
    };
    const material = {
      id: 'seedlands:material/model/brass',
      name: '定制黄铜材质',
      revision: 2,
      source: 'user' as const,
      type: 'material' as const,
      payload: {
        textureId: texture.id,
        renderMode: 'opaque' as const,
        roughness: 0.2,
        metalness: 0.8,
        emissive: [0, 0, 0] as [number, number, number],
        emissiveIntensity: 0,
      },
    };
    const assets = new GameplayModelAssets({ graphicsDevice: {} } as never, [texture, material]);

    expect(assets.materials.brass.diffuseMap?.name).toBe('custom:brass');
    expect(assets.materials.brass.gloss).toBeCloseTo(0.8);
    expect(assets.materials.brass.metalness).toBe(0.8);
    assets.dispose();
  });

  it('透明材质保留 terrain 的采样、金属和混合语义', async () => {
    const { GameplayModelAssets } = await import('../../apps/web/src/app/gameplay/gameplay-model-assets');
    const texture = {
      id: 'custom:water',
      name: '定制水面',
      revision: 2,
      source: 'user' as const,
      type: 'pixel-texture' as const,
      payload: {
        width: 16,
        height: 16,
        palette: [
          [0, 0, 0],
          [50, 120, 180],
        ] as [number, number, number][],
        pixels: Array(256).fill(1),
      },
    };
    const material = {
      id: 'seedlands:material/terrain/dirt',
      name: '定制泥土材质',
      revision: 2,
      source: 'user' as const,
      type: 'material' as const,
      payload: {
        textureId: texture.id,
        renderMode: 'transparent' as const,
        roughness: 0.2,
        metalness: 0.6,
        emissive: [0, 0, 0] as [number, number, number],
        emissiveIntensity: 0,
      },
    };
    const assets = new GameplayModelAssets({ graphicsDevice: {} } as never, [texture, material]);
    const parent = new (await import('playcanvas')).Entity('water');

    assets.addItem(parent, 'dirt-block');
    const runtimeMaterial = firstChild(parent).render.meshInstances[0].material as {
      useMetalness: boolean;
      diffuseMap: { minFilter: unknown };
      opacityMap: unknown;
      blendType: number;
      depthWrite: boolean;
    };

    expect(runtimeMaterial.useMetalness).toBe(true);
    expect(runtimeMaterial.diffuseMap.minFilter).toBe(2);
    expect(runtimeMaterial.opacityMap).toBe(runtimeMaterial.diffuseMap);
    expect(runtimeMaterial.blendType).toBe(2);
    expect(runtimeMaterial.depthWrite).toBe(false);
    assets.dispose();
  });

  it('镂空材质使用 alpha test 和双面光照', async () => {
    const { GameplayModelAssets } = await import('../../apps/web/src/app/gameplay/gameplay-model-assets');
    const texture = {
      id: 'custom:leaf',
      name: '定制叶片',
      revision: 2,
      source: 'user' as const,
      type: 'pixel-texture' as const,
      payload: {
        width: 16,
        height: 16,
        palette: [
          [0, 0, 0],
          [60, 150, 80],
        ] as [number, number, number][],
        pixels: Array(256).fill(1),
      },
    };
    const material = {
      id: 'seedlands:material/terrain/dirt',
      name: '定制镂空材质',
      revision: 2,
      source: 'user' as const,
      type: 'material' as const,
      payload: {
        textureId: texture.id,
        renderMode: 'cutout' as const,
        roughness: 0.8,
        metalness: 0,
        emissive: [0, 0, 0] as [number, number, number],
        emissiveIntensity: 0,
      },
    };
    const assets = new GameplayModelAssets({ graphicsDevice: {} } as never, [texture, material]);
    const parent = new (await import('playcanvas')).Entity('cutout');

    assets.addItem(parent, 'dirt-block');
    const runtimeMaterial = firstChild(parent).render.meshInstances[0].material as {
      diffuseMap: unknown;
      opacityMap: unknown;
      alphaTest: number;
      twoSidedLighting: boolean;
    };

    expect(runtimeMaterial.opacityMap).toBe(runtimeMaterial.diffuseMap);
    expect(runtimeMaterial.alphaTest).toBe(0.5);
    expect(runtimeMaterial.twoSidedLighting).toBe(true);
    assets.dispose();
  });

  it('工具从当前像素模型和贴图构建，并以 revision 区分缓存 Mesh', async () => {
    const { GameplayModelAssets } = await import('../../apps/web/src/app/gameplay/gameplay-model-assets');
    const pc = await import('playcanvas');
    const texture = {
      id: 'custom:axe-pixels',
      name: '单像素木斧',
      revision: 3,
      source: 'user' as const,
      type: 'pixel-texture' as const,
      payload: {
        width: 16,
        height: 16,
        palette: [
          [0, 0, 0],
          [200, 130, 60],
        ] as [number, number, number][],
        pixels: [1, ...Array(255).fill(0)],
      },
    };
    const model = (revision: number) => ({
      id: 'builtin:model:wood-axe',
      name: '单像素木斧模型',
      revision,
      source: 'user' as const,
      type: 'extruded-pixel-model' as const,
      payload: {
        textureId: texture.id,
        thicknessPixels: 2,
        grip: [0, 0] as [number, number],
        generatorVersion: 1 as const,
      },
    });
    const assets = new GameplayModelAssets({ graphicsDevice: {} } as never);
    const first = new pc.Entity('first');
    const second = new pc.Entity('second');

    assets.addItem(first, 'wood-axe', 1, [texture, model(1)]);
    assets.addItem(second, 'wood-axe', 1, [texture, model(2)]);

    const firstMesh = firstChild(first).render.meshInstances[0].mesh;
    const secondMesh = firstChild(second).render.meshInstances[0].mesh;
    expect(firstMesh.indices).toHaveLength(36);
    expect(secondMesh).not.toBe(firstMesh);
    assets.dispose();
  });

  it('addBox 按模型私有绑定读取当前 runtime 材质', async () => {
    const { GameplayModelAssets } = await import('../../apps/web/src/app/gameplay/gameplay-model-assets');
    const { setAppearanceResources } = await import('../../apps/web/src/app/gameplay/appearance-runtime');
    const pc = await import('playcanvas');
    const app = { graphicsDevice: {} } as never;
    const texture = {
      id: 'custom:grazer-fur',
      name: '食草兽毛皮像素',
      revision: 1,
      source: 'user' as const,
      type: 'pixel-texture' as const,
      payload: {
        width: 16,
        height: 16,
        palette: [
          [0, 0, 0],
          [120, 80, 30],
        ] as [number, number, number][],
        pixels: Array(256).fill(1),
      },
    };
    const material = {
      id: 'custom:grazer-fur-material',
      name: '食草兽毛皮材质',
      revision: 1,
      source: 'user' as const,
      type: 'material' as const,
      payload: {
        textureId: texture.id,
        renderMode: 'opaque' as const,
        roughness: 0.6,
        metalness: 0.7,
        emissive: [0, 0, 0] as [number, number, number],
        emissiveIntensity: 0,
      },
    };
    setAppearanceResources(app, {
      schemaVersion: 1,
      assets: [texture, material],
      materialBindings: { 'seedlands:model/actor/grazer': { 'seedlands:material/model/fur': material.id } },
      thumbnails: {},
    });
    const assets = new GameplayModelAssets(app);
    const parent = new pc.Entity('grazer');

    assets.addBox(
      parent,
      'body',
      'fur',
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 1, z: 1 },
      { modelId: 'seedlands:model/actor/grazer' },
    );

    expect((firstChild(parent).render.material as { diffuseMap: { name: string } }).diffuseMap.name).toBe(texture.id);
    assets.dispose();
  });
});
