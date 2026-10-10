import type { GameplayEntityView } from '@seedlands/stdlib/server/protocol/authority-worker-protocol';
import * as pc from 'playcanvas';
import { describe, expect, it, vi } from 'vitest';
import { GameplayEntityPresenter } from '../../../src/app/gameplay/gameplay-entity-presenter';
import { FirstPersonViewmodel } from '../../../src/app/player/first-person-viewmodel';
import { createSurfaceLightingSample } from '../../../src/app/scene/surface-lighting';
import type { GameplayModelAssets } from '../../../src/app/gameplay/gameplay-model-assets';

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
