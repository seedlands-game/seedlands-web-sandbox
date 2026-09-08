import { beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  callback: null as null | ((error: string | null, asset?: unknown) => void),
  loadGlbBlob: vi.fn(),
}));

vi.mock('../../apps/web/src/client/persistence/glb-model-store', () => ({ loadGlbBlob: state.loadGlbBlob }));

describe('GLB 预览归一化', () => {
  it('在 wrapper 空间中缩放并抵消中心，不修改 GLB 原始根节点', async () => {
    const { normalizeGlbBounds } = await import('../../apps/web/src/app/gameplay/glb-model-resource');
    const transform = normalizeGlbBounds([10, -4, 2], [12, -2, 4]);
    expect(transform.scale).toBe(0.75);
    expect(transform.position).toEqual([-8.25, 2.25, -2.25]);
    expect(normalizeGlbBounds([10, -4, 2], [12, -2, 4], 'feet').position).toEqual([-8.25, 3, -2.25]);
    expect(
      transform.position.map(
        (offset, axis) => offset + (([10, -4, 2][axis] + [12, -2, 4][axis]) / 2) * transform.scale,
      ),
    ).toEqual([0, 0, 0]);
  });

  it('动画控制器按权威动作标识去重，移动和受伤使用各自绑定', async () => {
    const { createModelAnimationController } = await import('../../apps/web/src/app/gameplay/model-animation');
    const play = vi.fn();
    const locate = vi.fn();
    const controller = createModelAnimationController(
      { idle: 'Idle', move: 'Walk', attack: 'Attack', hurt: 'Hurt' },
      { play, locate },
    );
    controller.update({ moving: false, hurtSequence: null, activeAction: null });
    controller.update({ moving: true, hurtSequence: null, activeAction: null });
    controller.update({
      moving: true,
      hurtSequence: null,
      activeAction: {
        actionId: 'action-1',
        comboStep: 0,
        phase: 'windup',
        phaseElapsedSeconds: 0.5,
        phaseDurationSeconds: 1,
      },
    });
    controller.update({
      moving: true,
      hurtSequence: null,
      activeAction: {
        actionId: 'action-1',
        comboStep: 0,
        phase: 'hit',
        phaseElapsedSeconds: 0.25,
        phaseDurationSeconds: 0.5,
      },
    });
    controller.update({
      moving: true,
      hurtSequence: null,
      activeAction: {
        actionId: 'action-1',
        comboStep: 1,
        phase: 'windup',
        phaseElapsedSeconds: 0,
        phaseDurationSeconds: 0.2,
      },
    });
    controller.update({ moving: false, hurtSequence: 4, activeAction: null });
    expect(play.mock.calls).toEqual([
      ['Idle', { loop: true, blendSeconds: 0 }],
      ['Walk', { loop: true, blendSeconds: 0.12 }],
      ['Attack', { loop: false, blendSeconds: 0.06 }],
      ['Attack', { loop: false, blendSeconds: 0.06 }],
      ['Hurt', { loop: false, blendSeconds: 0.04 }],
    ]);
    expect(locate).toHaveBeenCalledTimes(3);
    expect(locate.mock.calls[0][0]).toBeCloseTo(0.175);
    expect(locate.mock.calls[0][1]).toBeCloseTo(0.35);
    expect(locate.mock.calls[1][0]).toBeCloseTo(0.475);
    expect(locate.mock.calls[1][1]).toBeCloseTo(0.5);
    expect(locate.mock.calls[2][0]).toBeCloseTo(0);
    expect(locate.mock.calls[2][1]).toBeCloseTo(1.75);
  });

  it('取消后仍释放迟到完成时才出现的容器资源', async () => {
    const { addGlbModel } = await import('../../apps/web/src/app/gameplay/glb-model-resource');
    const resourceDestroy = vi.fn();
    const asset = {
      loaded: false,
      resource: undefined as undefined | { destroy: () => void },
      unload: vi.fn(function (this: { loaded: boolean; resource?: { destroy: () => void } }) {
        if (!this.loaded && !this.resource) return;
        this.resource?.destroy();
        this.resource = undefined;
        this.loaded = false;
      }),
    };
    const assets = {
      getByUrl: vi.fn(() => asset),
      remove: vi.fn(),
      loadFromUrlAndFilename: vi.fn(
        (_url: string, _filename: string, _type: string, callback: (error: string | null, asset?: unknown) => void) => {
          state.callback = callback;
        },
      ),
    };
    state.loadGlbBlob.mockResolvedValue(new Blob(['glb']));
    const controller = new AbortController();
    const loading = addGlbModel({ assets } as never, {} as never, 'delayed', controller.signal);
    await vi.waitFor(() => expect(state.callback).not.toBeNull());
    controller.abort();
    await expect(loading).rejects.toThrow(/取消/);
    expect(asset.unload).toHaveBeenCalledTimes(1);

    asset.loaded = true;
    asset.resource = { destroy: resourceDestroy };
    state.callback!(null, asset);

    expect(assets.remove).toHaveBeenCalledTimes(2);
    expect(asset.unload).toHaveBeenCalledTimes(2);
    expect(resourceDestroy).toHaveBeenCalledTimes(1);
  });
});

beforeEach(() => {
  state.callback = null;
  state.loadGlbBlob.mockReset();
});
