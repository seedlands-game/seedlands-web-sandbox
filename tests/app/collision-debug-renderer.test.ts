import { beforeEach, describe, expect, it, vi } from 'vitest';

const destroy = vi.fn();
const meshDestroy = vi.fn();
const materialDestroy = vi.fn();
const instanceVertexColors = vi.fn();

vi.mock('playcanvas', () => {
  class Entity {
    render: { meshInstances: unknown[]; layers: number[] } | null = null;
    constructor(readonly name: string) {}
    addComponent() {
      this.render = { meshInstances: [], layers: [] };
    }
    destroy = destroy;
  }
  class StandardMaterial {
    name = '';
    diffuseVertexColor = false;
    emissiveVertexColor = false;
    useLighting = true;
    emissive: unknown;
    depthWrite = true;
    update() {}
    destroy = materialDestroy;
  }
  class Mesh {
    constructor(readonly device: unknown) {}
    clear() {}
    setPositions() {}
    hasColors = false;
    vertexBuffer: { format: { hasColor: boolean } } | null = null;
    setColors() {
      this.hasColors = true;
    }
    update() {
      this.vertexBuffer = { format: { hasColor: this.hasColors } };
    }
    destroy = meshDestroy;
  }
  class MeshInstance {
    visible = true;
    castShadow = true;
    receiveShadow = true;
    constructor(
      readonly mesh: Mesh,
      readonly material: unknown,
      readonly entity: unknown,
    ) {
      instanceVertexColors(mesh.vertexBuffer?.format.hasColor ?? false);
    }
  }
  return {
    Entity,
    StandardMaterial,
    Mesh,
    MeshInstance,
    Color: { WHITE: {} },
    LAYERID_IMMEDIATE: 7,
    PRIMITIVE_LINES: 1,
  };
});

describe('碰撞调试渲染资源', () => {
  beforeEach(() => vi.clearAllMocks());

  it('关闭后释放唯一批次资源且不会在后台继续重建', async () => {
    const { CollisionDebugRenderer } = await import('../../src/app/collision-debug-renderer');
    const renderer = new CollisionDebugRenderer({
      graphicsDevice: {},
      root: { addChild: vi.fn() },
    } as never);
    const batch = {
      epoch: 'test',
      physicsTick: 1,
      positions: new Float32Array([0, 0, 0, 1, 1, 1]),
      colors: new Float32Array([1, 0, 0, 1, 0, 0]),
      lines: [],
      visibleBodyCount: 1,
      truncatedBodyCount: 0,
      visibleSensorCount: 0,
      contactCount: 0,
    };

    expect(renderer.diagnostics).toEqual({
      enabled: false,
      entityCount: 0,
      meshCount: 0,
      materialCount: 0,
      visibleBatchCount: 0,
      vertexCapacity: 0,
      buildCount: 0,
    });
    renderer.setEnabled(true);
    renderer.update(batch);
    expect(instanceVertexColors).toHaveBeenCalledWith(true);
    expect(renderer.diagnostics).toMatchObject({
      enabled: true,
      entityCount: 1,
      meshCount: 1,
      materialCount: 1,
      visibleBatchCount: 1,
      vertexCapacity: 2,
      buildCount: 1,
    });

    renderer.setEnabled(false);
    expect(renderer.diagnostics).toMatchObject({
      enabled: false,
      entityCount: 0,
      meshCount: 0,
      materialCount: 0,
      visibleBatchCount: 0,
      vertexCapacity: 0,
      buildCount: 1,
    });
    renderer.update(batch);
    expect(renderer.diagnostics.buildCount).toBe(1);
    expect(destroy).toHaveBeenCalledOnce();
    expect(meshDestroy).toHaveBeenCalledOnce();
    expect(materialDestroy).toHaveBeenCalledOnce();
  });
});
