import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PackPresentationCatalog } from '../../../src/client/presentation/pack-presentation-loader';

const state = vi.hoisted(() => ({
  textures: [] as Array<{
    options: Record<string, unknown>;
    setSource: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
  }>,
  materials: [] as Array<{
    alphaTest: number;
    cull: number;
    twoSidedLighting: boolean;
    specular: { set: ReturnType<typeof vi.fn> };
    emissive: { set: ReturnType<typeof vi.fn> };
    destroy: ReturnType<typeof vi.fn>;
    getShaderChunks: ReturnType<typeof vi.fn>;
  }>,
  meshes: [] as Array<{
    positions?: Float32Array;
    normals?: Float32Array;
    uvs?: Float32Array;
    indices?: Uint32Array;
    primitive: Array<{ count: number }>;
    destroy: ReturnType<typeof vi.fn>;
  }>,
  instances: [] as Array<{
    parameters: Map<string, unknown>;
    castShadow: boolean;
    visible: boolean;
    setParameter: ReturnType<typeof vi.fn>;
    getParameter: ReturnType<typeof vi.fn>;
  }>,
  entities: [] as Array<{
    name: string;
    render: unknown;
    children: unknown[];
    enabled: boolean;
    destroy: ReturnType<typeof vi.fn>;
    addComponent: ReturnType<typeof vi.fn>;
  }>,
  images: 0,
  failDecodeAt: -1,
  failSetSourceAt: -1,
}));

vi.mock('playcanvas', () => {
  class Texture {
    setSource = vi.fn(() => {
      if (state.textures.indexOf(this as never) === state.failSetSourceAt) throw new Error('setSource failed');
    });
    destroy = vi.fn();
    constructor(
      _device: unknown,
      readonly options: Record<string, unknown>,
    ) {
      state.textures.push(this as never);
    }
  }
  class StandardMaterial {
    name = '';
    diffuseMap: Texture | null = null;
    opacityMap: Texture | null = null;
    opacityMapChannel = '';
    alphaTest = 0;
    cull = 0;
    twoSidedLighting = false;
    shaderChunksVersion = '';
    specular = { set: vi.fn() };
    emissive = { set: vi.fn() };
    chunks = new Map<string, string>();
    update = vi.fn();
    destroy = vi.fn();
    getShaderChunks = vi.fn(() => this.chunks);
    constructor() {
      state.materials.push(this as never);
    }
  }
  class Mesh {
    positions?: Float32Array;
    normals?: Float32Array;
    uvs?: Float32Array;
    indices?: Uint32Array;
    primitive: Array<{ count: number }> = [];
    destroy = vi.fn();
    constructor(_device: unknown) {
      state.meshes.push(this as never);
    }
    setPositions(value: Float32Array) {
      this.positions = value;
    }
    setNormals(value: Float32Array) {
      this.normals = value;
    }
    setUvs(_channel: number, value: Float32Array) {
      this.uvs = value;
    }
    setIndices(value: Uint32Array) {
      this.indices = value;
      this.primitive = [{ count: value.length }];
    }
    getPositions(target: Float32Array[]) {
      if (this.positions) target.push(this.positions);
      return this.positions?.length ? this.positions.length / 3 : 0;
    }
    update() {}
  }
  class MeshInstance {
    parameters = new Map<string, unknown>();
    castShadow = true;
    visible = true;
    setParameter = vi.fn((name: string, value: unknown) => this.parameters.set(name, value));
    getParameter = vi.fn((name: string) => {
      const data = this.parameters.get(name);
      return data === undefined ? undefined : { data };
    });
    constructor(
      readonly mesh: Mesh,
      readonly material: StandardMaterial,
      readonly node: Entity,
    ) {
      state.instances.push(this as never);
    }
  }
  class Entity {
    render: unknown = null;
    children: unknown[] = [];
    enabled = true;
    destroy = vi.fn();
    addComponent = vi.fn((kind: string, options: Record<string, unknown>) => {
      if (kind === 'render') this.render = options;
    });
    constructor(readonly name: string) {
      state.entities.push(this as never);
    }
    setLocalPosition() {}
  }
  return {
    Texture,
    StandardMaterial,
    Mesh,
    MeshInstance,
    Entity,
    FILTER_NEAREST: 1,
    ADDRESS_CLAMP_TO_EDGE: 2,
    CULLFACE_NONE: 0,
    SHADERLANGUAGE_GLSL: 'glsl',
  };
});

const definition = {
  id: 'sample:crop',
  stages: Array.from({ length: 8 }, (_, stage) => ({ texture: `crop/${stage}.svg`, width: 0.6, height: 0.75 })),
};
function catalog(): PackPresentationCatalog {
  return {
    voxels: {},
    items: {},
    actors: {},
    materials: {},
    crops: { [definition.id]: definition },
    assetUrls: Object.fromEntries(definition.stages.map((stage) => [stage.texture, `/assets/${stage.texture}`])),
    dispose: vi.fn(),
  };
}

beforeEach(() => {
  state.textures.length = 0;
  state.materials.length = 0;
  state.meshes.length = 0;
  state.instances.length = 0;
  state.entities.length = 0;
  state.images = 0;
  state.failDecodeAt = -1;
  state.failSetSourceAt = -1;
  vi.stubGlobal(
    'Image',
    class {
      naturalWidth = 16;
      naturalHeight = 32;
      set src(_value: string) {}
      async decode() {
        const index = state.images++;
        if (index === state.failDecodeAt) throw new Error('decode failed');
      }
    },
  );
});

describe('PlayCanvas crop stage adapter', () => {
  it('batches crossed crop geometry into one render-only entity and owns only its assets', async () => {
    const { createPlayCanvasCropPresentation } = await import('../../../src/app/world/playcanvas-crop-stage-adapter');
    const app = { graphicsDevice: {}, root: { addChild: vi.fn() } } as never;
    const adapter = await createPlayCanvasCropPresentation(app, catalog());
    const brick = { destroy: vi.fn() } as unknown as import('playcanvas').Texture;
    const origin = new Float32Array([0, 0, 0]);
    const batch = {
      chunkKey: '0:0:0',
      cx: 0,
      cy: 0,
      cz: 0,
      presentationId: definition.id,
      stage: 3,
      definition: definition.stages[3]!,
      positions: [
        [1, 2, 3],
        [4, 2, 5],
      ] as const,
    };
    const resource = adapter.create(batch);
    expect(state.entities).toHaveLength(1);
    expect(state.entities[0]!.addComponent).toHaveBeenCalledOnce();
    expect(state.entities[0]!.addComponent).toHaveBeenCalledWith(
      'render',
      expect.objectContaining({ castShadows: false }),
    );
    expect(state.entities[0]!.render).toBeTruthy();
    expect(state.meshes[0]!.positions).toHaveLength(48);
    expect(state.meshes[0]!.normals).toHaveLength(48);
    expect(state.meshes[0]!.uvs).toHaveLength(32);
    expect(state.meshes[0]!.indices).toHaveLength(24);
    expect(Math.max(...state.meshes[0]!.indices!)).toBeLessThan(16);
    expect(state.meshes[0]!.positions!.slice(0, 12)).toEqual(
      new Float32Array([1.2, 3, 3.2, 1.8, 3, 3.8, 1.8, 3.75, 3.8, 1.2, 3.75, 3.2]),
    );
    expect(state.meshes[0]!.positions!.slice(12, 24)).toEqual(
      new Float32Array([1.2, 3, 3.8, 1.8, 3, 3.2, 1.8, 3.75, 3.2, 1.2, 3.75, 3.8]),
    );
    expect(Math.max(...state.meshes[0]!.positions!)).toBeCloseTo(5.8);
    expect(state.materials[3]).toMatchObject({ alphaTest: 0.5, cull: 0, twoSidedLighting: true });
    expect(state.materials[3]!.specular.set).toHaveBeenCalledWith(0, 0, 0);
    expect(state.materials[3]!.emissive.set).toHaveBeenCalledWith(1, 1, 1);
    expect(state.textures[0]!.options).toMatchObject({ minFilter: 1, magFilter: 1, mipmaps: false });

    adapter.bindChunkLight('0:0:0', { blockLightTexture: brick, blockLightOrigin: origin, blockLightSize: 34 });
    expect(resource.instance.setParameter).toHaveBeenCalledWith('texture_blockLight', brick);
    expect(resource.instance.setParameter).toHaveBeenCalledWith('uBlockLightOrigin', origin);
    expect(resource.instance.setParameter).toHaveBeenCalledWith('uBlockLightSize', 34);
    expect(adapter.snapshot()).toEqual([
      {
        chunkKey: '0:0:0',
        presentationId: definition.id,
        stage: 3,
        positions: [
          [1, 2, 3],
          [4, 2, 5],
        ],
        vertexCount: 16,
        indexCount: 24,
        enabled: true,
        lightingBound: true,
      },
    ]);
    expect(Object.isFrozen(adapter.snapshot())).toBe(true);
    expect(Object.isFrozen(adapter.snapshot()[0]!.positions[0])).toBe(true);
    const replacementBrick = { destroy: vi.fn() } as unknown as import('playcanvas').Texture;
    adapter.bindChunkLight('0:0:0', {
      blockLightTexture: replacementBrick,
      blockLightOrigin: new Float32Array([1, 0, 0]),
      blockLightSize: 34,
    });
    expect(resource.instance.setParameter).toHaveBeenCalledWith('texture_blockLight', replacementBrick);
    adapter.destroy(resource);
    adapter.destroy(resource);
    expect(adapter.snapshot()).toEqual([]);
    expect(resource.entity.destroy).toHaveBeenCalledOnce();
    expect(resource.mesh.destroy).toHaveBeenCalledOnce();
    expect(brick.destroy).not.toHaveBeenCalled();
    expect(replacementBrick.destroy).not.toHaveBeenCalled();

    adapter.dispose();
    adapter.dispose();
    expect(adapter.snapshot()).toEqual([]);
    expect(state.materials.every((material) => material.destroy.mock.calls.length === 1)).toBe(true);
    expect(state.textures.every((texture) => texture.destroy.mock.calls.length === 1)).toBe(true);
    expect(brick.destroy).not.toHaveBeenCalled();
    expect(replacementBrick.destroy).not.toHaveBeenCalled();
  });

  it('rejects a missing borrowed light brick without taking ownership of terrain resources', async () => {
    const { createPlayCanvasCropPresentation } = await import('../../../src/app/world/playcanvas-crop-stage-adapter');
    const adapter = await createPlayCanvasCropPresentation(
      { graphicsDevice: {}, root: { addChild: vi.fn() } } as never,
      catalog(),
    );
    adapter.create({
      chunkKey: '0:0:0',
      cx: 0,
      cy: 0,
      cz: 0,
      presentationId: definition.id,
      stage: 0,
      definition: definition.stages[0]!,
      positions: [[0, 0, 0]],
    });
    expect(() => adapter.bindChunkLight('0:0:0', undefined)).toThrow('resident terrain light brick');
    adapter.dispose();
    expect(state.entities[0]!.destroy).toHaveBeenCalledOnce();
  });

  it('releases all initialized assets when image decoding or texture upload fails partway through the pack', async () => {
    const { createPlayCanvasCropPresentation } = await import('../../../src/app/world/playcanvas-crop-stage-adapter');
    state.failDecodeAt = 3;
    await expect(
      createPlayCanvasCropPresentation({ graphicsDevice: {}, root: { addChild: vi.fn() } } as never, catalog()),
    ).rejects.toThrow('decode failed');
    expect(state.textures).toHaveLength(3);
    expect(state.materials).toHaveLength(3);
    expect(state.textures.every((texture) => texture.destroy.mock.calls.length === 1)).toBe(true);
    expect(state.materials.every((material) => material.destroy.mock.calls.length === 1)).toBe(true);

    state.textures.length = 0;
    state.materials.length = 0;
    state.images = 0;
    state.failDecodeAt = -1;
    state.failSetSourceAt = 2;
    await expect(
      createPlayCanvasCropPresentation({ graphicsDevice: {}, root: { addChild: vi.fn() } } as never, catalog()),
    ).rejects.toThrow('setSource failed');
    expect(state.textures).toHaveLength(3);
    expect(state.materials).toHaveLength(2);
    expect(state.textures.every((texture) => texture.destroy.mock.calls.length === 1)).toBe(true);
    expect(state.materials.every((material) => material.destroy.mock.calls.length === 1)).toBe(true);
  });
});
