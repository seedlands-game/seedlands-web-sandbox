import type { GameplayEntityView } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import * as pc from 'playcanvas';
import { describe, expect, it, vi } from 'vitest';
import { GameplayEntityPresenter } from '../../../src/app/gameplay/gameplay-entity-presenter';
import { FirstPersonViewmodel } from '../../../src/app/player/first-person-viewmodel';
import { createSurfaceLightingSample } from '../../../src/app/scene/surface-lighting';
import type { GameplayModelAssets } from '../../../src/app/gameplay/gameplay-model-assets';
import { ModelSurfaceLighting } from '../../../src/app/scene/model-surface-lighting';
import {
  createPresentedSurfaceLightingSampler,
  createWorldSurfaceLightingSampler,
} from '../../../src/app/scene/world-surface-lighting';

const fixture = vi.hoisted(() => ({ material: null as pc.StandardMaterial | null }));
function addPart(parent: pc.Entity, name: string) {
  const node = new pc.Entity(name);
  const mesh = { material: fixture.material! } as unknown as pc.MeshInstance;
  Object.defineProperty(node, 'render', {
    value: {
      meshInstances: [mesh],
      get material() {
        return mesh.material;
      },
      set material(value) {
        mesh.material = value;
      },
    },
  });
  parent.addChild(node);
  return node;
}
vi.mock('../../../src/app/gameplay/appearance-runtime', () => ({
  getAppearanceAnimationBindings: () => ({}),
  getAppearanceModelBlob: () => undefined,
  getPackActorPresentation: () => null,
}));
vi.mock('../../../src/app/gameplay/glb-model-resource', () => ({
  addGlbModel: async (_app: pc.Application, parent: pc.Entity) => ({
    entity: addPart(parent, 'actor-body'),
    animationClips: ['idle', 'move', 'attack', 'hurt'],
    playback: { play: vi.fn(), locate: vi.fn() },
    release: vi.fn(),
  }),
}));
vi.mock('../../../src/app/gameplay/gameplay-model-assets', () => ({
  acquireGameplayModelAssets: () => ({ release: () => {}, assets: { addBox: addPart, addItem: addPart } }),
}));

function setup() {
  fixture.material = new pc.StandardMaterial();
  fixture.material.emissive.set(0.2, 0.3, 0.4);
  fixture.material.emissiveIntensity = 0.7;
  const device = new pc.NullGraphicsDevice({ width: 640, height: 360 } as HTMLCanvasElement);
  const root = new pc.Entity();
  let ready = true;
  const sample = vi.fn((_position: readonly number[], self: readonly [number, number, number] = [0, 0, 0]) =>
    createSurfaceLightingSample({
      skyVisibility: ready ? 0.5 : null,
      skyRadiance: [0.4, 0.4, 0.4],
      blockIrradiance: [0.1, 0.2, 0.3],
      selfEmission: self,
    }),
  );
  return {
    root,
    device,
    sample,
    unknown: () => {
      ready = false;
    },
    app: { root, graphicsDevice: device } as unknown as pc.Application,
  };
}
function received(material: pc.StandardMaterial) {
  return Array.from(
    ((material.getParameter('uSurfaceReceivedLighting') as { data: Float32Array } | undefined)?.data as Float32Array) ??
      [],
  );
}

describe('实际模型消费者的共同受光', () => {
  it('bounds four-material model sampling to one coherent world read per apply', () => {
    const f = setup();
    const sky = vi.fn(() => ({ ready: true, visibility: 0.5 }));
    const block = vi.fn(() => 15);
    const world = {
      sampleSurfaceLighting: createWorldSurfaceLightingSampler({ sample: sky }, { sampleKnown: block }),
    };
    const frame = { skyRadiance: [0.4, 0.4, 0.4] as const, blockLightTint: [0.1, 0.2, 0.3] as const };
    const sample = createPresentedSurfaceLightingSampler(() => [world, frame]);
    const light = new ModelSurfaceLighting(f.device, sample);
    for (let i = 0; i < 4; i++) addPart(f.root, `part-${i}`);
    light.register(f.root);
    const counts = [];
    for (let repeat = 0; repeat < 2; repeat++) {
      sky.mockClear();
      block.mockClear();
      for (let i = 0; i < 64; i++) light.apply(f.root, [1, 2, 3]);
      counts.push({ sky: sky.mock.calls.length, block: block.mock.calls.length });
    }
    for (const node of f.root.children)
      expect(received((node as pc.Entity).render!.material as pc.StandardMaterial)).toEqual([
        expect.closeTo(0.3),
        expect.closeTo(0.4),
        expect.closeTo(0.5),
      ]);
    console.info('Model lighting exact world query counts:', JSON.stringify({ materials: 4, applies: 64, counts }));
    light.dispose();
    expect(counts).toEqual([
      { sky: 64, block: 64 },
      { sky: 64, block: 64 },
    ]);
  });

  it('retains each opaque legacy sampler invocation and material emission independently', () => {
    const f = setup();
    const light = new ModelSurfaceLighting(f.device, f.sample);
    for (let i = 0; i < 4; i++) addPart(f.root, `part-${i}`);
    light.register(f.root);
    light.apply(f.root, [1, 2, 3]);
    expect(f.sample).toHaveBeenCalledTimes(4);
    for (const call of f.sample.mock.calls) expect(call[0]).toEqual([1, 2, 3]);
    f.unknown();
    light.apply(f.root, [1, 2, 3]);
    expect(f.sample).toHaveBeenCalledTimes(8);
    for (const node of f.root.children) {
      const material = (node as pc.Entity).render!.material as pc.StandardMaterial;
      expect(received(material)).toEqual([0, 0, 0]);
      expect(material.emissiveIntensity).toBe(0.7);
    }
    light.dispose();
  });

  it('rejects a malformed batch before assigning undefined material lighting', () => {
    const f = setup();
    const sample = Object.assign(f.sample, { batch: () => [] });
    const light = new ModelSurfaceLighting(f.device, sample);
    addPart(f.root, 'part');
    light.register(f.root);
    expect(() => light.apply(f.root, [1, 2, 3])).toThrow('Surface lighting batch length');
    light.dispose();
  });

  it('rejects a sparse batch and keeps empty models free of sampler reads', () => {
    const f = setup();
    const batch = vi.fn(() => Array(1));
    const sample = Object.assign(f.sample, { batch });
    const light = new ModelSurfaceLighting(f.device, sample);
    light.apply(f.root, [1, 2, 3]);
    expect(batch).not.toHaveBeenCalled();
    expect(f.sample).not.toHaveBeenCalled();
    addPart(f.root, 'part');
    light.register(f.root);
    expect(() => light.apply(f.root, [1, 2, 3])).toThrow('Surface lighting batch length');
    light.dispose();
  });

  it('updates every batch material immediately on unknown while retaining independent damage emission and sources', () => {
    const f = setup();
    let ready = true;
    const world = {
      sampleSurfaceLighting: createWorldSurfaceLightingSampler(
        { sample: () => ({ ready, visibility: 0.5 }) },
        { sampleKnown: () => 15 },
      ),
    };
    const frame = { skyRadiance: [0.4, 0.4, 0.4] as const, blockLightTint: [0.1, 0.2, 0.3] as const };
    const sample = createPresentedSurfaceLightingSampler(() => [world, frame]);
    const batch = vi.fn(sample.batch!);
    const tracked = Object.assign((...args: Parameters<typeof sample>) => sample(...args), { batch });
    const sources = [fixture.material!.clone(), fixture.material!.clone()];
    sources[1]!.emissive.set(0.7, 0.1, 0.5);
    const parts = sources.map((source, index) => {
      const part = addPart(f.root, `part-${index}`);
      part.render!.meshInstances[0]!.material = source;
      return part;
    });
    const light = new ModelSurfaceLighting(f.device, tracked, (source) => source.clone());
    light.register(f.root);
    light.apply(f.root, [1, 2, 3]);
    const original = parts.map((part) => part.render!.material as pc.StandardMaterial);
    light.apply(f.root, [1, 2, 3], true);
    const damaged = parts.map((part) => part.render!.material as pc.StandardMaterial);
    expect(batch.mock.calls[1]![1]).toEqual(
      sources.map((source) => {
        const color = source.emissive.clone().linear();
        return [
          color.r * source.emissiveIntensity,
          color.g * source.emissiveIntensity,
          color.b * source.emissiveIntensity,
        ];
      }),
    );
    expect(batch.mock.calls[1]![1][0]).not.toEqual(batch.mock.calls[1]![1][1]);
    ready = false;
    light.apply(f.root, [1, 2, 3], true);
    damaged.forEach((material, index) => {
      expect(material).not.toBe(original[index]);
      expect(material).not.toBe(sources[index]);
      expect(received(material)).toEqual([0, 0, 0]);
      expect(material.emissiveIntensity).toBe(sources[index]!.emissiveIntensity);
      expect(material.emissive.equals(sources[index]!.emissive)).toBe(true);
      expect(sources[index]!.getParameter('uSurfaceReceivedLighting')).toBeUndefined();
    });
    light.dispose();
    sources.forEach((source) => source.destroy());
  });

  it('world-item 不把方块光写成自身发光，unknown当帧清received并保留借用源', () => {
    const f = setup();
    const presenter = new GameplayEntityPresenter(f.app, undefined, f.sample);
    const entity: GameplayEntityView = {
      id: 'drop',
      type: 'world-item' as const,
      kind: 'world-item' as const,
      lifecycle: 'active' as const,
      position: [1, 2, 3],
      stack: { itemId: 'dirt-block', count: 1 },
    };
    presenter.reconcile([entity]);
    const material = (f.root.findByName('dirt-block') as pc.Entity).render!.material as pc.StandardMaterial;
    expect(received(material)).toEqual([expect.closeTo(0.3), expect.closeTo(0.4), expect.closeTo(0.5)]);
    expect(material.emissiveIntensity).toBe(0.7);
    expect(fixture.material!.getParameter('uSurfaceReceivedLighting')).toBeUndefined();
    f.unknown();
    presenter.reconcile([entity]);
    expect(received(material)).toEqual([0, 0, 0]);
    expect(material.emissiveIntensity).toBe(0.7);
    presenter.dispose();
  });
  it('异步actor真实消费者保持受击材质独立emission并从相同sample取得received', async () => {
    const f = setup();
    const presenter = new GameplayEntityPresenter(f.app, undefined, f.sample);
    const entity: GameplayEntityView = {
      id: 'pig',
      type: 'npc' as const,
      kind: 'npc' as const,
      lifecycle: 'active' as const,
      archetype: 'pig' as const,
      position: [0, 60, 0],
      health: 20,
    };
    presenter.reconcile([entity]);
    await vi.waitFor(() => expect(presenter.presentedModelReady('pig')).toBe(true));
    presenter.reconcile([entity], 0.01);
    const part = f.root.findByName('actor-body') as pc.Entity;
    const original = part.render!.material as pc.StandardMaterial;
    expect(received(original)[1]).toBeCloseTo(0.4);
    presenter.reconcile([{ ...entity, health: 19 }], 0.01);
    const damage = part.render!.material as pc.StandardMaterial;
    expect(damage).not.toBe(original);
    expect(damage.emissiveIntensity).toBe(0.7);
    expect(received(damage)[2]).toBeCloseTo(0.5);
    f.unknown();
    presenter.reconcile([{ ...entity, health: 19 }], 0.01);
    expect(received(damage)).toEqual([0, 0, 0]);
    const originalRelease = vi.spyOn(original, 'destroy'),
      damageRelease = vi.spyOn(damage, 'destroy');
    presenter.dispose();
    expect(originalRelease).toHaveBeenCalledOnce();
    expect(damageRelease).toHaveBeenCalledOnce();
  });
  it('手臂与工具都按相机所在世界位置采样，换工具释放自有clone且源材质不变', () => {
    const f = setup();
    const camera = new pc.Entity();
    camera.setPosition(4, 33, 6);
    const assets = { addBox: addPart, addItem: addPart } as unknown as GameplayModelAssets;
    const model = new FirstPersonViewmodel(f.app, camera, assets, undefined, f.sample);
    model.setHeldItem('wood-axe');
    model.update(0);
    const arm = (camera.findByName('hand') as pc.Entity).render!.material as pc.StandardMaterial;
    const tool = (camera.findByName('wood-axe') as pc.Entity).render!.material as pc.StandardMaterial;
    expect(received(arm)[0]).toBeCloseTo(0.3);
    expect(received(tool)[2]).toBeCloseTo(0.5);
    expect(f.sample.mock.calls.every(([position]) => position.join(',') === '4,33,6')).toBe(true);
    const release = vi.spyOn(tool, 'destroy');
    model.setHeldItem(null);
    expect(release).toHaveBeenCalledOnce();
    f.unknown();
    model.update(0);
    expect(received(arm)).toEqual([0, 0, 0]);
    expect(fixture.material!.getParameter('uSurfaceReceivedLighting')).toBeUndefined();
    model.dispose();
  });
});
