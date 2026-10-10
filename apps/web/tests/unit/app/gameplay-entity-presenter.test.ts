import * as pc from 'playcanvas';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GameplayEntityPresenter } from '../../../src/app/gameplay/gameplay-entity-presenter';
import type { GameplayEntity } from '../../../../../packages/stdlib/src/server/gameplay/entity-store';
import { defineTransportV1 } from '../../../../../packages/stdlib/src/server/gameplay/modules/transport-model';

const animationState = vi.hoisted(() => ({
  bindings: {} as Record<string, unknown>,
  blob: undefined as Blob | undefined,
  addGlbModel: vi.fn(),
  pack: null as null | { binding: { id: string; model: string; texture: string }; url: string },
}));

vi.mock('../../../src/app/gameplay/appearance-runtime', () => ({
  getAppearanceAnimationBindings: () => animationState.bindings,
  getAppearanceModelBlob: () => animationState.blob,
  getPackActorPresentation: () => animationState.pack,
}));

vi.mock('../../../src/app/gameplay/glb-model-resource', () => ({
  addGlbModel: animationState.addGlbModel,
}));

vi.mock('../../../src/app/gameplay/gameplay-model-assets', () => ({
  acquireGameplayModelAssets: () => ({
    release: vi.fn(),
    assets: {
      materials: {},
      addBox(
        parent: pc.Entity,
        name: string,
        _material: unknown,
        position?: Readonly<{ x: number; y: number; z: number }>,
      ) {
        const child = new pc.Entity(name);
        if (position) child.setLocalPosition(position.x, position.y, position.z);
        parent.addChild(child);
        return child;
      },
      addItem(parent: pc.Entity, id: string) {
        parent.addChild(new pc.Entity(id));
      },
    },
  }),
}));

const item = (y: number): GameplayEntity => ({
  id: 'drop',
  type: 'world-item',
  kind: 'world-item',
  lifecycle: 'active',
  position: [0, y, 0],
  physicsVelocity: [0, -1, 0],
  stack: { itemId: 'dirt-block', count: 1 },
});

const pig = (x: number): GameplayEntity => ({
  id: 'pig',
  type: 'npc',
  kind: 'npc',
  lifecycle: 'active',
  archetype: 'pig',
  position: [x, 0, 0],
});

const reconcileFrame = (
  presenter: GameplayEntityPresenter,
  entities: readonly GameplayEntity[],
  renderDeltaSeconds: number,
) => presenter.reconcile(entities, renderDeltaSeconds);

describe('玩法实体的独立表现时钟', () => {
  beforeEach(() => {
    animationState.bindings = {};
    animationState.pack = null;
    animationState.blob = undefined;
    animationState.addGlbModel.mockReset();
    animationState.addGlbModel.mockImplementation(async (_app: pc.Application, parent: pc.Entity) => {
      const entity = new pc.Entity('default-pig');
      parent.addChild(entity);
      return {
        entity,
        animationClips: ['idle', 'move', 'attack', 'hurt'],
        playback: { play: vi.fn(), locate: vi.fn() },
        release: vi.fn(),
      };
    });
  });

  it('同份accepted transport定义取得Pack模型，静止时保留Authority yaw并在移除时释放', async () => {
    const root = new pc.Entity('root');
    const presenter = new GameplayEntityPresenter({ root } as pc.Application);
    const definition = defineTransportV1({
      version: 1,
      id: 'test:carrier',
      locomotion: { provider: 'route', providerId: 'test:rail' },
      bodyAabb: { min: { x: -0.4, y: 0, z: -0.4 }, max: { x: 0.4, y: 0.7, z: 0.4 } },
      seatOffset: [0, 0.55, 0],
      presentationId: 'test:carrier-model',
    });
    animationState.pack = {
      binding: { id: 'test:carrier-model', model: 'models/carrier.glb', texture: 'models/carrier.glb' },
      url: 'blob:verified-carrier',
    };
    const transport = {
      version: 2 as const,
      reference: { entityId: 'carrier', lifetime: 1 },
      definitionId: definition.id,
      pose: { position: [2, 31, 0] as const, yaw: Math.PI / 2 },
      velocity: [0, 0, 0] as const,
      routeCursor: null,
      rider: null,
      fuel: null,
      inventory: [],
    };
    const entity: GameplayEntity = {
      id: 'carrier',
      type: 'transport',
      kind: 'transport',
      lifecycle: 'active',
      position: [2, 31, 0],
    };
    presenter.reconcile([entity], 0, [transport], [definition]);
    await vi.waitFor(() => expect(animationState.addGlbModel).toHaveBeenCalledTimes(1));
    expect(animationState.addGlbModel.mock.calls[0]![2]).toBe('pack:test:carrier-model');
    expect(animationState.addGlbModel.mock.calls[0]![6]).toBe('blob:verified-carrier');
    expect(root.findByName('gameplay:carrier')!.getEulerAngles().y).toBeCloseTo(90);
    const lease = await animationState.addGlbModel.mock.results[0]!.value;
    presenter.reconcile([entity], 0, [{ ...transport, reference: { entityId: 'carrier', lifetime: 2 } }], [definition]);
    await vi.waitFor(() => expect(animationState.addGlbModel).toHaveBeenCalledTimes(2));
    expect(lease.release).toHaveBeenCalledTimes(1);
    const replacement = await animationState.addGlbModel.mock.results[1]!.value;
    presenter.reconcile([], 0, [], [definition]);
    expect(root.findByName('gameplay:carrier')).toBeNull();
    expect(lease.release).toHaveBeenCalledTimes(1);
    expect(replacement.release).toHaveBeenCalledTimes(1);
  });

  it('每50ms前进2cm的慢速目标不会在快照回调跳动，并在中间渲染帧继续前进', () => {
    const root = new pc.Entity('root');
    const presenter = new GameplayEntityPresenter({ root } as pc.Application);
    reconcileFrame(presenter, [item(1)], 0);
    const beforeSnapshot = root.findByName('gameplay:drop')!.getPosition().y;

    reconcileFrame(presenter, [item(0.98)], 0);
    const afterSnapshot = root.findByName('gameplay:drop')!.getPosition().y;
    reconcileFrame(presenter, [item(0.98)], 1 / 60);
    const firstRenderFrame = root.findByName('gameplay:drop')!.getPosition().y;
    reconcileFrame(presenter, [item(0.98)], 1 / 60);
    const secondRenderFrame = root.findByName('gameplay:drop')!.getPosition().y;

    expect(afterSnapshot).toBe(beforeSnapshot);
    expect(firstRenderFrame).toBeLessThan(afterSnapshot);
    expect(secondRenderFrame).toBeLessThan(firstRenderFrame);
    expect(secondRenderFrame).toBeGreaterThan(1.08);
  });

  it('权威快照未更新的渲染帧仍连续推进掉落物节点', () => {
    const root = new pc.Entity('root');
    const presenter = new GameplayEntityPresenter({ root } as pc.Application);
    reconcileFrame(presenter, [item(3)], 0);
    reconcileFrame(presenter, [item(2.5)], 0);
    const afterSnapshot = root.findByName('gameplay:drop')!.getPosition().y;

    reconcileFrame(presenter, [item(2.5)], 1 / 60);
    const nextRenderFrame = root.findByName('gameplay:drop')!.getPosition().y;

    expect(nextRenderFrame).toBeLessThan(afterSnapshot);
    expect(nextRenderFrame).toBeGreaterThanOrEqual(2.6);
  });

  it('落地快照不允许表现节点外推穿地，拾取后同一帧移除节点', () => {
    const root = new pc.Entity('root');
    const presenter = new GameplayEntityPresenter({ root } as pc.Application);
    reconcileFrame(presenter, [item(1)], 0);
    reconcileFrame(presenter, [item(0)], 0);

    const positions: number[] = [];
    for (let frame = 0; frame < 30; frame += 1) {
      reconcileFrame(presenter, [item(0)], 1 / 60);
      positions.push(root.findByName('gameplay:drop')!.getPosition().y);
    }
    expect(Math.min(...positions)).toBeGreaterThanOrEqual(0.1);
    expect(positions.at(-1)).toBeCloseTo(0.1, 6);

    reconcileFrame(presenter, [], 1 / 60);
    expect(root.findByName('gameplay:drop')).toBeNull();
  });

  it('仅在动态投影实体的表现发生变化时提升阴影 revision', () => {
    const root = new pc.Entity('root');
    const presenter = new GameplayEntityPresenter({ root } as pc.Application);

    expect(presenter.shadowCasters).toEqual([]);
    reconcileFrame(presenter, [item(1)], 0);
    const created = presenter.shadowCasters[0]!.revision;
    expect(created).toBeGreaterThan(0);

    reconcileFrame(presenter, [item(1)], 0);
    expect(presenter.shadowCasters[0]!.revision).toBe(created);

    reconcileFrame(presenter, [item(1)], 1 / 60);
    const rotated = presenter.shadowCasters[0]!.revision;
    expect(rotated).toBeGreaterThan(created);

    reconcileFrame(presenter, [item(0)], 1 / 60);
    const moved = presenter.shadowCasters[0]!.revision;
    expect(moved).toBeGreaterThan(rotated);

    reconcileFrame(presenter, [], 1 / 60);
    expect(presenter.shadowCasters).toEqual([]);
  });

  it('非法或负表现步长不污染节点，后续合法帧仍可推进', () => {
    const root = new pc.Entity('root');
    const presenter = new GameplayEntityPresenter({ root } as pc.Application);
    reconcileFrame(presenter, [item(1)], 0);
    reconcileFrame(presenter, [item(0)], 0);
    const before = root.findByName('gameplay:drop')!.getPosition().y;

    reconcileFrame(presenter, [item(0)], Number.NaN);
    reconcileFrame(presenter, [item(0)], -1);
    expect(root.findByName('gameplay:drop')!.getPosition().y).toBe(before);

    reconcileFrame(presenter, [item(0)], 1 / 60);
    const recovered = root.findByName('gameplay:drop')!.getPosition().y;
    expect(Number.isFinite(recovered)).toBe(true);
    expect(recovered).toBeLessThan(before);
  });

  it('未覆盖物种默认装载专属GLB并保持米制比例', async () => {
    const root = new pc.Entity('root');
    const app = { root } as pc.Application;
    const presenter = new GameplayEntityPresenter(app);
    reconcileFrame(presenter, [pig(0)], 0);
    await vi.waitFor(() => expect(root.findByName('default-pig')).not.toBeNull());
    expect(animationState.addGlbModel).toHaveBeenCalledWith(
      app,
      expect.any(pc.Entity),
      'seedlands:model/actor/pig',
      expect.any(AbortSignal),
      undefined,
      'authored',
      undefined,
    );
    expect(root.findByName('fallback-body')).toBeNull();
    presenter.dispose();
  });

  it('实体移除后异步模型结果释放且不重新挂载', async () => {
    const root = new pc.Entity('root');
    const app = { root } as pc.Application;
    const release = vi.fn();
    let complete: ((value: unknown) => void) | undefined;
    animationState.addGlbModel.mockImplementation(
      () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
    );
    const presenter = new GameplayEntityPresenter(app);
    reconcileFrame(presenter, [pig(0)], 0);
    reconcileFrame(presenter, [], 0);
    complete?.({
      entity: new pc.Entity(),
      animationClips: ['idle'],
      playback: { play: vi.fn(), locate: vi.fn() },
      release,
    });
    await vi.waitFor(() => expect(release).toHaveBeenCalledOnce());
    expect(root.children).toHaveLength(0);
    presenter.dispose();
  });

  it('加载失败通过既有app事件反馈且不回退黑盒', async () => {
    const root = new pc.Entity('root');
    const fire = vi.fn();
    const app = { root, fire } as unknown as pc.Application;
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    animationState.addGlbModel.mockRejectedValue(new Error('HTTP 404'));
    const presenter = new GameplayEntityPresenter(app);
    reconcileFrame(presenter, [pig(0)], 0);
    await vi.waitFor(() =>
      expect(fire).toHaveBeenCalledWith('seedlands:asset-error', expect.stringContaining('HTTP 404')),
    );
    expect(root.findByName('fallback-body')).toBeNull();
    expect(root.findByName('asset-error:pig')).not.toBeNull();
    presenter.dispose();
    error.mockRestore();
  });

  it('猪模型只消费游戏启动时保存的绑定与 Blob 快照', async () => {
    const root = new pc.Entity('root');
    const app = { root } as pc.Application;
    const blob = new Blob(['startup-snapshot'], { type: 'model/gltf-binary' });
    animationState.bindings = {
      pig: { modelId: 'glb:pig', clips: { idle: 'Idle' } },
    };
    animationState.blob = blob;
    animationState.addGlbModel.mockImplementation(async (_app: pc.Application, parent: pc.Entity) => {
      const entity = new pc.Entity('snapshot-model');
      parent.addChild(entity);
      return {
        entity,
        animationClips: ['Idle'],
        playback: { play: vi.fn(), locate: vi.fn() },
        release: vi.fn(),
      };
    });
    const presenter = new GameplayEntityPresenter(app);

    reconcileFrame(presenter, [pig(0)], 0);

    await vi.waitFor(() => expect(animationState.addGlbModel).toHaveBeenCalledOnce());
    expect(animationState.addGlbModel).toHaveBeenCalledWith(
      app,
      expect.any(pc.Entity),
      'glb:pig',
      expect.any(AbortSignal),
      blob,
      'feet',
      undefined,
    );
    presenter.dispose();
  });
});
