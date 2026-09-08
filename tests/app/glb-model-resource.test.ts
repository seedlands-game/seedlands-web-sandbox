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
    expect(
      transform.position.map(
        (offset, axis) => offset + (([10, -4, 2][axis] + [12, -2, 4][axis]) / 2) * transform.scale,
      ),
    ).toEqual([0, 0, 0]);
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
