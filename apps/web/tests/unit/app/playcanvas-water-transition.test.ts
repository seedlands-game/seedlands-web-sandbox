import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  mesh: null as null | {
    positions?: Float32Array;
    normals?: Float32Array;
    uvs?: Float32Array;
    colors?: Uint8Array;
    indices?: Uint32Array;
    morph?: unknown;
  },
  morphTargetOptions: null as null | { name: string; deltaPositions: unknown },
  weights: [] as Array<[number, number]>,
  instanceDestroy: vi.fn(),
  meshDestroy: vi.fn(),
  rejectMorph: false,
}));

vi.mock('playcanvas', () => {
  class Mesh {
    positions?: Float32Array;
    normals?: Float32Array;
    uvs?: Float32Array;
    colors?: Uint8Array;
    indices?: Uint32Array;
    morph?: unknown;
    constructor(readonly device: unknown) {
      state.mesh = this;
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
    setColors32(value: Uint8Array) {
      this.colors = value;
    }
    setIndices(value: Uint32Array) {
      this.indices = value;
    }
    update() {}
    destroy = state.meshDestroy;
  }
  class MorphTarget {
    constructor(options: { name: string; deltaPositions: unknown }) {
      state.morphTargetOptions = options;
    }
  }
  class Morph {
    constructor(
      readonly targets: MorphTarget[],
      readonly device: unknown,
    ) {
      if (state.rejectMorph) throw new Error('GPU morph unavailable');
    }
  }
  class MorphInstance {
    constructor(readonly morph: Morph) {}
    setWeight(index: number, weight: number) {
      state.weights.push([index, weight]);
    }
  }
  class MeshInstance {
    drawOrder = 0;
    castShadow = true;
    morphInstance: MorphInstance | null = null;
    constructor(
      readonly mesh: Mesh,
      readonly material: unknown,
      readonly node: unknown,
    ) {}
    destroy = state.instanceDestroy;
  }
  return { Mesh, MorphTarget, Morph, MorphInstance, MeshInstance };
});

describe('PlayCanvas 水面 GPU Morph 资源', () => {
  beforeEach(() => {
    state.mesh = null;
    state.morphTargetOptions = null;
    state.weights.length = 0;
    state.instanceDestroy.mockClear();
    state.meshDestroy.mockClear();
    state.rejectMorph = false;
  });

  it('上传单份起始几何和 Float32 位移，并对权重与销毁执行有界幂等处理', async () => {
    const { createPlayCanvasWaterTransition } = await import('../../../src/app/scene/playcanvas-water-transition');
    const startPositions = new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0]);
    const deltaPositions = new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0]);
    const normals = new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1]);
    const uvs = new Float32Array([0, 0, 1, 0, 1, 1, 0, 1]);
    const colors = new Uint8Array(16).fill(255);
    const indices = new Uint32Array([0, 1, 2, 0, 2, 3]);

    const transition = createPlayCanvasWaterTransition(
      { graphicsDevice: { id: 'device' } } as never,
      {
        startPositions,
        deltaPositions,
        normals,
        uvs,
        colors,
        indices,
        patchKeys: ['top:1:0:0'],
        patchKinds: new Uint8Array([0]),
      },
      { name: 'water-material' } as never,
      { name: 'water-node' } as never,
    );

    expect(state.mesh).toMatchObject({ positions: startPositions, normals, uvs, colors, indices });
    expect(state.morphTargetOptions).toEqual({
      name: 'committed-water-surface',
      deltaPositions,
    });
    expect(transition.instance).toMatchObject({ drawOrder: 1000, castShadow: false });

    transition.setProgress(-1);
    transition.setProgress(0.4);
    transition.setProgress(2);
    expect(state.weights).toEqual([
      [0, 0],
      [0, 0.4],
      [0, 1],
    ]);

    transition.destroy();
    transition.destroy();
    transition.setProgress(0.5);
    expect(state.instanceDestroy).toHaveBeenCalledOnce();
    expect(state.weights).toHaveLength(3);
  });

  it('创建 Morph 失败时释放已经分配的临时 Mesh', async () => {
    const { createPlayCanvasWaterTransition } = await import('../../../src/app/scene/playcanvas-water-transition');
    state.rejectMorph = true;

    expect(() =>
      createPlayCanvasWaterTransition(
        { graphicsDevice: {} } as never,
        {
          startPositions: new Float32Array(12),
          deltaPositions: new Float32Array(12),
          normals: new Float32Array(12),
          uvs: new Float32Array(8),
          colors: new Uint8Array(16),
          indices: new Uint32Array([0, 1, 2, 0, 2, 3]),
          patchKeys: ['top:1:0:0'],
          patchKinds: new Uint8Array([0]),
        },
        {} as never,
        {} as never,
      ),
    ).toThrow('GPU morph unavailable');
    expect(state.meshDestroy).toHaveBeenCalledOnce();
    expect(state.instanceDestroy).not.toHaveBeenCalled();
  });
});
